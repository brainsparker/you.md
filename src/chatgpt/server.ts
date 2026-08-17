import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import { getPackageVersion } from "../utils/version.js";
import { CHATGPT_TOOLS, findTool } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

/**
 * Instructions the client sees at connect time.
 *
 * The packaged skill (apps/chatgpt/skills/you-md/SKILL.md) carries the full
 * workflow; this is the short form for clients that only read server
 * instructions, and it says the one thing that is easy to get wrong: the model
 * writes the profile, the server only stores it.
 */
export const SERVER_INSTRUCTIONS = `you.md stores a portable profile of the user that other AI tools can read.

You write the profile; this server only validates and stores it. It never infers
anything about the user on its own.

- To create: write the complete you.md markdown yourself from what you already
  know about the user, then call youmd_create_profile.
- To change anything: call youmd_get_profile, edit that markdown, and call
  youmd_update_profile with the version you fetched as base_version.
- To hand the user the file: call youmd_export_profile.

Only include information you have real evidence for: stable preferences,
repeated behavior, professional context, current projects, goals, and anything
that would help another AI work with this user. Leave out incidental details,
short-lived state, guesses, and sensitive information that does not improve
personalization. Never invent facts. A short accurate profile beats a long
speculative one.`;

export interface ChatGptServerOptions extends ToolContext {
  /** Server name reported to the client. Defaults to "you-md-chatgpt". */
  readonly name?: string;
}

/**
 * Build an MCP server bound to a single authenticated user.
 *
 * One server instance per user (and, over HTTP, per request) is what keeps
 * profiles isolated: `userId` is captured here and tool arguments can never
 * override it.
 */
export function createChatGptServer(options: ChatGptServerOptions): Server {
  const context: ToolContext = {
    store: options.store,
    telemetry: options.telemetry,
    userId: options.userId,
    now: options.now,
  };

  const server = new Server(
    {
      name: options.name ?? "you-md-chatgpt",
      version: getPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CHATGPT_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = findTool(request.params.name);

    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${request.params.name}. Available tools: ${CHATGPT_TOOLS.map((t) => t.name).join(", ")}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(
        (request.params.arguments ?? {}) as Record<string, unknown>,
        context
      );

      return {
        content: result.content.map((item) => ({ ...item })),
        ...(result.structuredContent
          ? { structuredContent: result.structuredContent }
          : {}),
        ...(result.isError ? { isError: true } : {}),
      };
    } catch (error) {
      // Unexpected failures surface as tool errors, without internal detail.
      const message =
        error instanceof Error ? error.message : "Unknown internal error";
      return {
        content: [
          {
            type: "text" as const,
            text: `${tool.name} failed: ${message}`,
          },
        ],
        structuredContent: { error: "INTERNAL_ERROR", message },
        isError: true,
      };
    }
  });

  return server;
}
