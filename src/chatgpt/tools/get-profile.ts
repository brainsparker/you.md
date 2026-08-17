import type { ToolDefinition } from "./types.js";

export const getProfileTool: ToolDefinition = {
  name: "youmd_get_profile",
  title: "Get you.md profile",
  description:
    "Retrieve the user's current you.md profile and its version. Call this before any edit — " +
    "the version it returns is what youmd_update_profile needs as base_version.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      exists: { type: "boolean" },
      profile_id: { type: "string" },
      version: { type: "number" },
      markdown: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["exists"],
    additionalProperties: true,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  async handler(_args, context) {
    const record = await context.store.getProfile(context.userId);

    if (!record) {
      return {
        content: [
          {
            type: "text",
            text:
              "This user has no you.md profile yet. Offer to create one from what you know about them, " +
              "then call youmd_create_profile.",
          },
        ],
        structuredContent: { exists: false },
      };
    }

    return {
      content: [{ type: "text", text: record.markdown }],
      structuredContent: {
        exists: true,
        profile_id: record.profileId,
        version: record.version,
        markdown: record.markdown,
        updated_at: record.updatedAt,
      },
    };
  },
};
