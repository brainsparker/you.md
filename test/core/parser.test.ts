import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createParser } from "../../src/parser";

const fixturesDir = resolve(__dirname, "../../fixtures");

describe("YouMdParser", () => {
  const parser = createParser();

  describe("parse", () => {
    it("parses valid you.md content", () => {
      const content = `---
schema_version: "1.0"
author: "Test"
---

# Preferences

## Technical

Language: TypeScript
`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
      expect(result.profile.schemaVersion).toBe("1.0");
      expect(result.profile.metadata.author).toBe("Test");
      expect(result.profile.sections.size).toBeGreaterThan(0);
    });

    it("handles missing frontmatter gracefully", () => {
      const content = `# Just Markdown

No frontmatter here.
`;

      const result = parser.parse(content);

      // Missing frontmatter means missing schema_version (required per spec FR-02)
      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.code === "NO_FRONTMATTER")).toBe(true);
      expect(result.errors.some((e) => e.code === "MISSING_SCHEMA_VERSION")).toBe(true);
    });

    it("handles missing schema_version", () => {
      const content = `---
author: "Test"
---

# Content
`;

      const result = parser.parse(content);

      expect(result.errors.some((e) => e.code === "MISSING_SCHEMA_VERSION")).toBe(true);
    });

    it("rejects oversized content", () => {
      const largeContent = "x".repeat(200 * 1024); // 200KB

      const result = parser.parse(largeContent);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.code === "FILE_TOO_LARGE")).toBe(true);
    });
  });

  describe("loadFromPath", () => {
    it("loads minimal fixture", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/minimal.md`);

      expect(result.success).toBe(true);
      expect(result.profile.schemaVersion).toBe("1.0");
      expect(result.profile.sourcePath).toContain("minimal.md");
    });

    it("loads complete fixture", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/complete.md`);

      expect(result.success).toBe(true);
      expect(result.profile.metadata.author).toBe("Jane Developer");
      expect(result.profile.metadata.tags).toContain("python");
    });

    it("returns error for non-existent file", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/non-existent.md`);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.code === "FILE_NOT_FOUND")).toBe(true);
    });

    it("returns error when path is not a regular file", async () => {
      const dir = mkdtempSync(join(tmpdir(), "you-md-parser-dir-"));
      try {
        const result = await parser.loadFromPath(dir);

        expect(result.success).toBe(false);
        expect(result.errors.some((e) => e.code === "PERMISSION_DENIED")).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("handles malformed YAML", async () => {
      const result = await parser.loadFromPath(
        `${fixturesDir}/malformed/invalid-yaml.md`
      );

      // Should still parse, may have errors
      expect(result.profile).toBeDefined();
    });

    it("handles missing schema version", async () => {
      const result = await parser.loadFromPath(
        `${fixturesDir}/malformed/missing-schema-version.md`
      );

      expect(result.errors.some((e) => e.code === "MISSING_SCHEMA_VERSION")).toBe(
        true
      );
    });

    it("handles empty file", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/malformed/empty.md`);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("merge", () => {
    it("merges multiple profiles", async () => {
      const user = await parser.loadFromPath(`${fixturesDir}/merge/user-profile.md`);
      const project = await parser.loadFromPath(
        `${fixturesDir}/merge/project-profile.md`
      );

      const merged = parser.merge([user.profile, project.profile]);

      // Project should override user
      expect(merged.metadata.author).toBe("Project");
      // Should have sections from both
      expect(merged.sections.size).toBeGreaterThan(0);
    });

    it("handles empty array", () => {
      const merged = parser.merge([]);

      expect(merged.schemaVersion).toBe("1.1");
      expect(merged.sections.size).toBe(0);
    });

    it("returns single profile unchanged", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/minimal.md`);
      const merged = parser.merge([result.profile]);

      expect(merged).toBe(result.profile);
    });
  });

  describe("validate", () => {
    it("validates correct profile", async () => {
      const result = await parser.loadFromPath(`${fixturesDir}/complete.md`);
      const validation = parser.validate(result.profile);

      expect(validation.valid).toBe(true);
    });

    it("reports unsupported schema version", async () => {
      const result = await parser.loadFromPath(
        `${fixturesDir}/versions/unsupported-version.md`
      );
      const validation = parser.validate(result.profile);

      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some((e) => e.code === "UNSUPPORTED_SCHEMA_VERSION")
      ).toBe(true);
    });
  });
});
