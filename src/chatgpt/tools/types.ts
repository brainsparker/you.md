import type { ProfileStore } from "../storage/types.js";
import type { Telemetry } from "../telemetry.js";

/** Everything a tool handler is allowed to touch, scoped to one user. */
export interface ToolContext {
  readonly store: ProfileStore;
  readonly telemetry: Telemetry;
  /** Internal user id. Every storage call is scoped to it. */
  readonly userId: string;
  /** Injectable clock, so tests can pin timestamps. */
  readonly now?: () => Date;
}

export interface ToolTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface ToolResult {
  readonly content: ToolTextContent[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

export interface JsonSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: string[];
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  handler(
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

/** Shape a failure the model can act on: what went wrong and what to do next. */
export function toolError(
  code: string,
  message: string,
  details: string[] = []
): ToolResult {
  const text =
    details.length > 0
      ? `${message}\n\n${details.map((d) => `- ${d}`).join("\n")}`
      : message;

  return {
    content: [{ type: "text", text }],
    structuredContent: { error: code, message, details },
    isError: true,
  };
}
