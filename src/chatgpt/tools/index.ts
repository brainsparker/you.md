import { createProfileTool } from "./create-profile.js";
import { exportProfileTool } from "./export-profile.js";
import { getProfileTool } from "./get-profile.js";
import { updateProfileTool } from "./update-profile.js";
import type { ToolDefinition } from "./types.js";

export { createProfileTool } from "./create-profile.js";
export { exportProfileTool } from "./export-profile.js";
export { getProfileTool } from "./get-profile.js";
export { updateProfileTool } from "./update-profile.js";
export { toolError } from "./types.js";
export type {
  JsonSchema,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";

/**
 * The full tool surface, kept deliberately small: create, read, update, export.
 */
export const CHATGPT_TOOLS: ToolDefinition[] = [
  createProfileTool,
  getProfileTool,
  updateProfileTool,
  exportProfileTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return CHATGPT_TOOLS.find((tool) => tool.name === name);
}
