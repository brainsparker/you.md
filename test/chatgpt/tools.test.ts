import { describe, it, expect, beforeEach } from "vitest";

import { MemoryProfileStore } from "../../src/chatgpt/storage/memory.js";
import { NoopTelemetry, type Telemetry, type TelemetryEvent, type TelemetryProperties } from "../../src/chatgpt/telemetry.js";
import {
  createProfileTool,
  exportProfileTool,
  getProfileTool,
  updateProfileTool,
} from "../../src/chatgpt/tools/index.js";
import type { ToolContext, ToolResult } from "../../src/chatgpt/tools/types.js";

const PROFILE = `---
schema_version: "1.1"
---

# Me

## How I Communicate

Verbosity: concise
Tone: direct. Lead with the answer, then the reasoning if it matters.

## What I Do

Product manager at a developer tools company. Writes TypeScript daily and
reviews pull requests personally.
`;

const REVISED_PROFILE = PROFILE.replace(
  "Verbosity: concise",
  "Verbosity: very concise"
);

class RecordingTelemetry implements Telemetry {
  readonly events: { event: TelemetryEvent; userId: string; properties?: TelemetryProperties }[] = [];

  track(event: TelemetryEvent, userId: string, properties?: TelemetryProperties): void {
    this.events.push({ event, userId, properties });
  }

  names(): TelemetryEvent[] {
    return this.events.map((entry) => entry.event);
  }
}

function structured(result: ToolResult): Record<string, unknown> {
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as Record<string, unknown>;
}

describe("ChatGPT profile tools", () => {
  let store: MemoryProfileStore;
  let telemetry: RecordingTelemetry;
  let context: ToolContext;

  beforeEach(async () => {
    store = new MemoryProfileStore();
    telemetry = new RecordingTelemetry();
    const userId = await store.resolveUserId("chatgpt", "user-a");
    context = { store, telemetry, userId };
  });

  describe("youmd_create_profile", () => {
    it("creates version 1 and returns the stored markdown", async () => {
      const result = await createProfileTool.handler({ markdown: PROFILE }, context);
      const output = structured(result);

      expect(result.isError).toBeFalsy();
      expect(output.created).toBe(true);
      expect(output.version).toBe(1);
      expect(String(output.profile_id)).toMatch(/^prof_/);
      expect(String(output.markdown)).toContain("Verbosity: concise");
      expect(String(output.markdown)).toContain("last_updated:");
    });

    it("emits generation and creation telemetry without profile text", async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);

      expect(telemetry.names()).toEqual([
        "profile_generation_started",
        "profile_created",
      ]);

      const created = telemetry.events[1];
      expect(created.properties?.profile_section_count).toBe(2);
      expect(created.properties?.profile_word_count).toBeGreaterThan(15);
      expect(JSON.stringify(created)).not.toContain("Verbosity");
    });

    it("stores an optional structured profile alongside the markdown", async () => {
      await createProfileTool.handler(
        { markdown: PROFILE, structured_profile: { communication: { verbosity: "concise" } } },
        context
      );

      const record = await store.getProfile(context.userId);
      expect(record?.structured).toEqual({ communication: { verbosity: "concise" } });
    });

    it("refuses to overwrite an existing profile and points at update", async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);
      const result = await createProfileTool.handler({ markdown: REVISED_PROFILE }, context);

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("PROFILE_EXISTS");
      expect(result.content[0].text).toContain("youmd_update_profile");

      const record = await store.getProfile(context.userId);
      expect(record?.version).toBe(1);
      expect(record?.markdown).toContain("Verbosity: concise\n");
    });

    it("rejects invalid markdown with actionable reasons", async () => {
      const result = await createProfileTool.handler(
        { markdown: "# Me\n\nNo frontmatter at all, just some words here to fill it out.\n" },
        context
      );

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("INVALID_PROFILE");
      expect(result.content[0].text).toContain("frontmatter");
      expect(telemetry.names()).toContain("profile_rejected");
      expect(await store.getProfile(context.userId)).toBeNull();
    });
  });

  describe("youmd_get_profile", () => {
    it("reports that no profile exists yet", async () => {
      const result = await getProfileTool.handler({}, context);

      expect(result.isError).toBeFalsy();
      expect(structured(result)).toEqual({ exists: false });
    });

    it("returns the current markdown and version", async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);
      const output = structured(await getProfileTool.handler({}, context));

      expect(output.exists).toBe(true);
      expect(output.version).toBe(1);
      expect(String(output.markdown)).toContain("## What I Do");
      expect(typeof output.updated_at).toBe("string");
    });
  });

  describe("youmd_update_profile", () => {
    beforeEach(async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);
      telemetry.events.length = 0;
    });

    it("applies an update at the current version", async () => {
      const result = await updateProfileTool.handler(
        { markdown: REVISED_PROFILE, base_version: 1 },
        context
      );
      const output = structured(result);

      expect(output.updated).toBe(true);
      expect(output.version).toBe(2);
      expect(String(output.markdown)).toContain("Verbosity: very concise");
      expect(telemetry.events[0]?.properties?.number_of_edits).toBe(1);
    });

    it("rejects a stale base_version and leaves the profile untouched", async () => {
      await updateProfileTool.handler({ markdown: REVISED_PROFILE, base_version: 1 }, context);

      const stale = await updateProfileTool.handler(
        { markdown: PROFILE, base_version: 1 },
        context
      );

      expect(stale.isError).toBe(true);
      expect(structured(stale).error).toBe("STALE_VERSION");
      expect(stale.content[0].text).toContain("youmd_get_profile");

      const record = await store.getProfile(context.userId);
      expect(record?.version).toBe(2);
      expect(record?.markdown).toContain("Verbosity: very concise");
    });

    it("rejects a non-integer base_version before touching storage", async () => {
      const result = await updateProfileTool.handler(
        { markdown: REVISED_PROFILE, base_version: "latest" },
        context
      );

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("INVALID_BASE_VERSION");
    });

    it("rejects invalid markdown without bumping the version", async () => {
      const result = await updateProfileTool.handler(
        { markdown: "just a sentence", base_version: 1 },
        context
      );

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("INVALID_PROFILE");
      expect((await store.getProfile(context.userId))?.version).toBe(1);
    });

    it("reports when there is no profile to update", async () => {
      const other = await store.resolveUserId("chatgpt", "user-without-profile");
      const result = await updateProfileTool.handler(
        { markdown: REVISED_PROFILE, base_version: 1 },
        { ...context, userId: other }
      );

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("PROFILE_NOT_FOUND");
    });

    it("keeps every prior version", async () => {
      await updateProfileTool.handler({ markdown: REVISED_PROFILE, base_version: 1 }, context);
      const versions = await store.listVersions(context.userId);

      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[1].markdown).toContain("Verbosity: concise\n");
    });
  });

  describe("youmd_export_profile", () => {
    it("returns the portable artifact", async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);
      const result = await exportProfileTool.handler({}, context);
      const output = structured(result);

      expect(output.filename).toBe("you.md");
      expect(output.mime_type).toBe("text/markdown");
      expect(String(output.content)).toContain("# Me");
      expect(result.content[0].text).toContain("# Me");
      expect(telemetry.names()).toContain("profile_exported");
    });

    it("reports when there is nothing to export", async () => {
      const result = await exportProfileTool.handler({}, context);

      expect(result.isError).toBe(true);
      expect(structured(result).error).toBe("PROFILE_NOT_FOUND");
      expect(telemetry.names()).not.toContain("profile_exported");
    });
  });

  describe("authorization", () => {
    it("keeps one user's profile invisible to another", async () => {
      await createProfileTool.handler({ markdown: PROFILE }, context);

      const otherUserId = await store.resolveUserId("chatgpt", "user-b");
      const otherContext: ToolContext = {
        store,
        telemetry: new NoopTelemetry(),
        userId: otherUserId,
      };

      expect(otherUserId).not.toBe(context.userId);
      expect(structured(await getProfileTool.handler({}, otherContext))).toEqual({
        exists: false,
      });
      expect((await exportProfileTool.handler({}, otherContext)).isError).toBe(true);

      // User B creating their own profile must not disturb user A's.
      const created = await createProfileTool.handler(
        { markdown: REVISED_PROFILE },
        otherContext
      );
      expect(structured(created).created).toBe(true);

      const a = await store.getProfile(context.userId);
      const b = await store.getProfile(otherUserId);
      expect(a?.markdown).toContain("Verbosity: concise\n");
      expect(b?.markdown).toContain("Verbosity: very concise");
      expect(a?.profileId).not.toBe(b?.profileId);
    });

    it("returns the same internal user id for a repeated identity", async () => {
      const first = await store.resolveUserId("chatgpt", "stable-user");
      const second = await store.resolveUserId("chatgpt", "stable-user");

      expect(first).toBe(second);
    });

    it("separates identities from different providers", async () => {
      const chatgpt = await store.resolveUserId("chatgpt", "same-id");
      const dev = await store.resolveUserId("dev", "same-id");

      expect(chatgpt).not.toBe(dev);
    });
  });
});
