import { ProfileNotFoundError } from "../errors.js";
import { toolError, type ToolDefinition } from "./types.js";

export const exportProfileTool: ToolDefinition = {
  name: "youmd_export_profile",
  title: "Export you.md",
  description:
    "Return the user's profile as a portable you.md file they can save and use in other AI tools. " +
    "Call this whenever the user asks to export, download, or take their profile somewhere else.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      filename: { type: "string" },
      mime_type: { type: "string" },
      content: { type: "string" },
      version: { type: "number" },
    },
    required: ["filename", "mime_type", "content"],
    additionalProperties: true,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  async handler(_args, context) {
    const { store, telemetry, userId } = context;
    const record = await store.getProfile(userId);

    if (!record) {
      const error = new ProfileNotFoundError();
      return toolError(error.code, error.message);
    }

    telemetry.track("profile_exported", userId, {
      export_format: "markdown",
      profile_version: record.version,
    });

    return {
      content: [{ type: "text", text: record.markdown }],
      structuredContent: {
        filename: "you.md",
        mime_type: "text/markdown",
        content: record.markdown,
        version: record.version,
      },
    };
  },
};
