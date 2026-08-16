import {
  ChatGptAppError,
  InvalidProfileError,
  ProfileNotFoundError,
  StaleVersionError,
} from "../errors.js";
import { validateProfileMarkdown } from "../validation.js";
import { toolError, type ToolDefinition } from "./types.js";

export const updateProfileTool: ToolDefinition = {
  name: "youmd_update_profile",
  title: "Update you.md profile",
  description:
    "Replace the user's you.md with a revised version you have written. " +
    "Fetch the current profile with youmd_get_profile first, edit only what the user asked to change, " +
    "keep everything else byte-for-byte, and pass the version you fetched as base_version.",
  inputSchema: {
    type: "object",
    properties: {
      markdown: {
        type: "string",
        description: "The complete revised you.md file, not a fragment or a diff.",
      },
      base_version: {
        type: "number",
        description:
          "Version returned by youmd_get_profile. The update is rejected if the profile changed since then.",
      },
      structured_profile: {
        type: "object",
        description: "Optional structured view of the same profile.",
        additionalProperties: true,
      },
    },
    required: ["markdown", "base_version"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      profile_id: { type: "string" },
      updated: { type: "boolean" },
      version: { type: "number" },
      markdown: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["profile_id", "updated", "version", "markdown"],
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

    const baseVersion = Number(args.base_version);
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      return toolError(
        "INVALID_BASE_VERSION",
        "base_version must be the positive integer version returned by youmd_get_profile.",
        ["Call youmd_get_profile and pass the `version` field it returns."]
      );
    }

    try {
      const validated = validateProfileMarkdown(args.markdown, {
        now: context.now?.(),
        stampCreated: false,
      });

      const record = await store.updateProfile({
        userId,
        markdown: validated.markdown,
        baseVersion,
        structured: (args.structured_profile as Record<string, unknown>) ?? null,
        source: "chatgpt",
      });

      telemetry.track("profile_updated", userId, {
        profile_section_count: validated.stats.sectionCount,
        profile_word_count: validated.stats.wordCount,
        profile_version: record.version,
        number_of_edits: record.version - 1,
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Updated you.md to version ${record.version}. ` +
              `Confirm the specific change to the user — don't reprint the whole profile unless they ask.` +
              (validated.warnings.length > 0
                ? `\n\nNotes: ${validated.warnings.join("; ")}`
                : ""),
          },
        ],
        structuredContent: {
          profile_id: record.profileId,
          updated: true,
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

      if (error instanceof StaleVersionError) {
        return toolError(error.code, error.message, [
          `Current version: ${error.currentVersion}.`,
        ]);
      }

      if (error instanceof ProfileNotFoundError) {
        return toolError(error.code, error.message);
      }

      if (error instanceof ChatGptAppError) {
        return toolError(error.code, error.message);
      }

      throw error;
    }
  },
};
