import { describe, it, expect, beforeEach } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createChatGptServer } from "../../src/chatgpt/server.js";
import { MemoryProfileStore } from "../../src/chatgpt/storage/memory.js";
import { NoopTelemetry } from "../../src/chatgpt/telemetry.js";

const PROFILE = `---
schema_version: "1.1"
---

# Me

## How I Communicate

Verbosity: concise. Prefers a direct answer before any explanation.

## What I Do

Backend engineer working mostly in Go, with a long-running side project in Rust.
`;

async function connect(store: MemoryProfileStore, userId: string): Promise<Client> {
  const server = createChatGptServer({
    store,
    telemetry: new NoopTelemetry(),
    userId,
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return client;
}

function structured(result: CallToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

describe("ChatGPT MCP server", () => {
  let store: MemoryProfileStore;
  let userId: string;

  beforeEach(async () => {
    store = new MemoryProfileStore();
    userId = await store.resolveUserId("chatgpt", "user-a");
  });

  it("advertises exactly the four profile tools with schemas", async () => {
    const client = await connect(store, userId);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "youmd_create_profile",
      "youmd_export_profile",
      "youmd_get_profile",
      "youmd_update_profile",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toBeDefined();
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }

    await client.close();
  });

  it("tells the client the model writes the profile, not the server", async () => {
    const client = await connect(store, userId);

    expect(client.getInstructions()).toContain("You write the profile");

    await client.close();
  });

  it("runs create → get → update → export over the protocol", async () => {
    const client = await connect(store, userId);

    const created = (await client.callTool({
      name: "youmd_create_profile",
      arguments: { markdown: PROFILE },
    })) as CallToolResult;
    expect(structured(created).version).toBe(1);

    const fetched = (await client.callTool({
      name: "youmd_get_profile",
      arguments: {},
    })) as CallToolResult;
    const currentMarkdown = String(structured(fetched).markdown);
    expect(currentMarkdown).toContain("Backend engineer");

    const updated = (await client.callTool({
      name: "youmd_update_profile",
      arguments: {
        markdown: currentMarkdown.replace("mostly in Go", "mostly in Go and Python"),
        base_version: Number(structured(fetched).version),
      },
    })) as CallToolResult;
    expect(structured(updated).version).toBe(2);

    const exported = (await client.callTool({
      name: "youmd_export_profile",
      arguments: {},
    })) as CallToolResult;
    expect(structured(exported).filename).toBe("you.md");
    expect(String(structured(exported).content)).toContain("Go and Python");

    await client.close();
  });

  it("reports an unknown tool as a tool error rather than a protocol failure", async () => {
    const client = await connect(store, userId);

    const result = (await client.callTool({
      name: "youmd_delete_everything",
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    await client.close();
  });

  it("surfaces an unexpected storage failure without leaking internals", async () => {
    const failing = new MemoryProfileStore();
    failing.getProfile = async () => {
      throw new Error("connection reset");
    };

    const client = await connect(failing, userId);
    const result = (await client.callTool({
      name: "youmd_export_profile",
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(structured(result).error).toBe("INTERNAL_ERROR");
    await client.close();
  });

  it("scopes tool calls to the connected user", async () => {
    const clientA = await connect(store, userId);
    await clientA.callTool({
      name: "youmd_create_profile",
      arguments: { markdown: PROFILE },
    });

    const otherUserId = await store.resolveUserId("chatgpt", "user-b");
    const clientB = await connect(store, otherUserId);

    const result = (await clientB.callTool({
      name: "youmd_get_profile",
      arguments: {},
    })) as CallToolResult;

    expect(structured(result)).toEqual({ exists: false });

    await clientA.close();
    await clientB.close();
  });
});
