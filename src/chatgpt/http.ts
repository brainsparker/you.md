import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  createAuthResolverFromEnv,
  type AuthResolver,
} from "./auth.js";
import { UnauthorizedError } from "./errors.js";
import { createChatGptServer } from "./server.js";
import { createStoreFromEnv } from "./storage/index.js";
import type { ProfileStore } from "./storage/types.js";
import { createTelemetryFromEnv, type Telemetry } from "./telemetry.js";

/** Requests larger than this are refused before we buffer them. */
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface HttpAppOptions {
  readonly store: ProfileStore;
  readonly auth: AuthResolver;
  readonly telemetry: Telemetry;
  /** Path the MCP endpoint is served on. Defaults to "/mcp". */
  readonly endpoint?: string;
}

/**
 * ChatGPT connects to a remotely reachable MCP endpoint, so this exposes the
 * server over Streamable HTTP.
 *
 * Each request gets its own MCP server and transport, bound to the user the
 * request authenticated as. Nothing is shared between requests except the
 * store, which is scoped by user id on every call.
 */
export function createHttpServer(options: HttpAppOptions): HttpServer {
  const endpoint = options.endpoint ?? "/mcp";

  return createServer((req, res) => {
    handleRequest(req, res, endpoint, options).catch((error) => {
      respondJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: string,
  options: HttpAppOptions
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    respondJson(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname !== endpoint) {
    respondJson(res, 404, { error: "not_found" });
    return;
  }

  let userId: string;
  try {
    const identity = await options.auth.authenticate(req.headers);
    userId = await options.store.resolveUserId(
      identity.provider,
      identity.providerUserId
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="you.md"');
      respondJson(res, 401, { error: "unauthorized", message: error.message });
      return;
    }
    throw error;
  }

  let body: unknown;
  if (req.method === "POST") {
    try {
      body = await readJsonBody(req);
    } catch (error) {
      respondJson(res, 400, {
        error: "invalid_request",
        message: error instanceof Error ? error.message : "Unreadable body",
      });
      return;
    }
  }

  const server = createChatGptServer({
    store: options.store,
    telemetry: options.telemetry,
    userId,
  });

  // Stateless: no session state to keep between requests, so a ChatGPT
  // conversation can reconnect from anywhere and still see its profile.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  if (size === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function respondJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Start the server from environment configuration.
 *
 * PORT, YOUMD_MCP_ENDPOINT, YOUMD_API_TOKENS, DATABASE_URL, YOUMD_TELEMETRY.
 */
export async function startHttpServerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<HttpServer> {
  const store = await createStoreFromEnv(env);
  const auth = createAuthResolverFromEnv(env);
  const telemetry = createTelemetryFromEnv(env);
  const endpoint = env.YOUMD_MCP_ENDPOINT ?? "/mcp";
  const port = Number(env.PORT ?? 8787);

  const server = createHttpServer({ store, auth, telemetry, endpoint });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });

  process.stderr.write(
    `you.md ChatGPT MCP server listening on http://localhost:${port}${endpoint}\n`
  );

  return server;
}
