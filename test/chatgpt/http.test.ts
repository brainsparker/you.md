import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { BearerTokenAuthResolver } from "../../src/chatgpt/auth.js";
import { createHttpServer } from "../../src/chatgpt/http.js";
import { MemoryProfileStore } from "../../src/chatgpt/storage/memory.js";
import { NoopTelemetry } from "../../src/chatgpt/telemetry.js";

const PROFILE = `---
schema_version: "1.1"
---

# Me

## What I Do

Data engineer maintaining a warehouse in Snowflake, most comfortable in SQL and
Python, and allergic to unnecessary abstraction.
`;

let running: Server | undefined;

async function startServer(): Promise<{ url: string; store: MemoryProfileStore }> {
  const store = new MemoryProfileStore();
  const server = createHttpServer({
    store,
    auth: BearerTokenAuthResolver.fromEnv("tok_a:user_a,tok_b:user_b"),
    telemetry: new NoopTelemetry(),
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running = server;

  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, store };
}

/** Minimal Streamable HTTP client: one JSON-RPC call, SSE response parsed out. */
async function rpc(
  url: string,
  token: string | null,
  method: string,
  params: Record<string, unknown>,
  id = 1
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  const text = await response.text();
  if (!response.ok) {
    return { status: response.status, body: null };
  }

  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data: "));

  return {
    status: response.status,
    body: JSON.parse(dataLine ? dataLine.slice(6) : text),
  };
}

const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "http-test", version: "1.0.0" },
};

afterEach(async () => {
  if (running) {
    await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = undefined;
  }
});

describe("remote MCP endpoint", () => {
  it("answers health checks without credentials", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rejects unauthenticated MCP requests with a challenge", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects an unknown token", async () => {
    const { url } = await startServer();
    const result = await rpc(url, "not-a-token", "initialize", INITIALIZE);

    expect(result.status).toBe(401);
  });

  it("returns 404 for paths other than the MCP endpoint", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/admin`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok_a" },
      body: "{}",
    });

    expect(response.status).toBe(404);
  });

  it("serves an authenticated tool call and persists it for that user only", async () => {
    const { url, store } = await startServer();

    await rpc(url, "tok_a", "initialize", INITIALIZE);

    const created = await rpc(
      url,
      "tok_a",
      "tools/call",
      { name: "youmd_create_profile", arguments: { markdown: PROFILE } },
      2
    );
    const createdResult = created.body?.result as { structuredContent: Record<string, unknown> };
    expect(createdResult.structuredContent.version).toBe(1);

    // A second, stateless request from the same account sees the same profile.
    const fetched = await rpc(url, "tok_a", "tools/call", {
      name: "youmd_get_profile",
      arguments: {},
    }, 3);
    const fetchedResult = fetched.body?.result as { structuredContent: Record<string, unknown> };
    expect(fetchedResult.structuredContent.exists).toBe(true);
    expect(String(fetchedResult.structuredContent.markdown)).toContain("Snowflake");

    // A different account sees nothing.
    const other = await rpc(url, "tok_b", "tools/call", {
      name: "youmd_get_profile",
      arguments: {},
    }, 4);
    const otherResult = other.body?.result as { structuredContent: Record<string, unknown> };
    expect(otherResult.structuredContent).toEqual({ exists: false });

    const userA = await store.resolveUserId("chatgpt", "user_a");
    expect(await store.getProfile(userA)).not.toBeNull();
  });
});
