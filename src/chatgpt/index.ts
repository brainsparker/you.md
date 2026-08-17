/**
 * you.md ChatGPT app — a remote MCP server that stores the profile ChatGPT
 * writes about the user.
 *
 * The division of labor is the whole design: ChatGPT synthesizes the profile
 * from context it already has, and this service validates, versions, and hands
 * it back. Nothing here infers anything about a user.
 */

export {
  BearerTokenAuthResolver,
  DevAuthResolver,
  createAuthResolverFromEnv,
  readBearerToken,
} from "./auth.js";
export type { AuthResolver, AuthenticatedIdentity } from "./auth.js";

export {
  ChatGptAppError,
  InvalidProfileError,
  ProfileExistsError,
  ProfileNotFoundError,
  StaleVersionError,
  UnauthorizedError,
} from "./errors.js";
export type { ChatGptErrorCode } from "./errors.js";

export { createHttpServer, startHttpServerFromEnv } from "./http.js";
export type { HttpAppOptions } from "./http.js";

export { SERVER_INSTRUCTIONS, createChatGptServer } from "./server.js";
export type { ChatGptServerOptions } from "./server.js";

export {
  MemoryProfileStore,
  PostgresProfileStore,
  createStoreFromEnv,
} from "./storage/index.js";
export type {
  CreateProfileInput,
  ProfileRecord,
  ProfileSource,
  ProfileStore,
  ProfileVersionRecord,
  SqlClient,
  UpdateProfileInput,
} from "./storage/index.js";

export {
  CHATGPT_TOOLS,
  createProfileTool,
  exportProfileTool,
  findTool,
  getProfileTool,
  updateProfileTool,
} from "./tools/index.js";
export type { ToolContext, ToolDefinition, ToolResult } from "./tools/index.js";

export {
  ConsoleTelemetry,
  NoopTelemetry,
  createTelemetryFromEnv,
} from "./telemetry.js";
export type {
  Telemetry,
  TelemetryEvent,
  TelemetryProperties,
} from "./telemetry.js";

export { stampFrontmatter, validateProfileMarkdown } from "./validation.js";
export type {
  ProfileStats,
  ValidateOptions,
  ValidatedProfile,
} from "./validation.js";
