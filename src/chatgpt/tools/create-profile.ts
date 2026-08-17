import { ChatGptAppError, InvalidProfileError, ProfileExistsError } from "../errors.js";
import { validateProfileMarkdown } from "../validation.js";
import { toolError, type ToolDefinition } from "./types.js";

export const createProfileTool: ToolDefinition = {
  name: "youmd_create_profile",
  title: "Create you.md profile",
  description:
    "Save the user's first you.md profile. Call this once you have written the complete you.md markdown yourself — " +
    "this tool stores what you send and never infers anything on its own. " +
    "Fails if a profile already exists; use youmd_update_profile to change an existing one.",
  inputSchema: {
    type: "object",
    properties: {
      markdown: {
        type: "string",
        description:
          "The complete you.md file, including YAML frontmatter with schema_version.",
      },
      structured_profile: {
        type: "object",
        description:
          "Optional structured view of the same profile. Stored as-is for later analysis; the markdown remains canonical.",
        additionalProperties: true,
      },
    },
    required: ["markdown"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      profile_id: { type: "string" },
      created: { type: "boolean" },
      version: { type: "number" },
      markdown: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["profile_id", "created", "version", "markdown"],
    additionalProperties: true,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  async handler(args, context) {
    const { store, telemetry, userId } = context;

    telemetry.track("profile_generation_started", userId);

    try {
      const validated = validateProfileMarkdown(args.markdown, {
        now: context.now?.(),
        stampCreated: true,
      });

      const record = await store.createProfile({
        userId,
        markdown: validated.markdown,
        structured: (args.structured_profile as Record<string, unknown>) ?? null,
        source: "chatgpt",
      });

      telemetry.track("profile_created", userId, {
        profile_section_count: validated.stats.sectionCount,
        profile_word_count: validated.stats.wordCount,
        profile_version: record.version,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Saved you.md (version ${record.version}, ${validated.stats.sectionCount} sections).\n\n` +
              `Show the user the profile you just wrote, say plainly what you left out and why, ` +
              `and offer to change or export it.` +
              (validated.warnings.length > 0
                ? `\n\nNotes: ${validated.warnings.join("; ")}`
                : ""),
          },
        ],
        structuredContent: {
          profile_id: record.profileId,
          created: true,
          version: record.version,
          markdown: record.markdown,
          warnings: validated.warnings,
        },
      };
    } catch (error) {
      if (error instanceof InvalidProfileError) {
        telemetry.track("profile_rejected", userId, { error_code: error.code });
        return toolError(error.code, error.message, error.reasons);
      }

      if (error instanceof ProfileExistsError) {
        return toolError(error.code, error.message, [
          `Existing profile version: ${error.version}.`,
          "Call youmd_get_profile, merge in what is new, then call youmd_update_profile.",
        ]);
      }

      if (error instanceof ChatGptAppError) {
        return toolError(error.code, error.message);
      }

      throw error;
    }
  },
};
