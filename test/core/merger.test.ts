import { describe, it, expect } from "vitest";
import { mergeProfiles } from "../../src/core/merger.js";
import type { YouMdProfile, YouMdSection } from "../../src/types/profile.js";

function makeSection(title: string, content: string, subsections: YouMdSection[] = []): YouMdSection {
  return {
    title,
    normalizedTitle: title.toLowerCase(),
    level: 2,
    content,
    fields: new Map(),
    subsections,
  };
}

function makeProfile(sections: [string, YouMdSection][]): YouMdProfile {
  return {
    schemaVersion: "1.1",
    metadata: { schemaVersion: "1.1" },
    sections: new Map(sections),
    rawContent: "",
  };
}

describe("mergeProfiles", () => {
  describe("subsection deduplication", () => {
    it("does not produce duplicate subsections after merge", () => {
      const base = makeProfile([
        ["how i work", makeSection("How I Work", "", [
          makeSection("Testing", "unit tests preferred"),
          makeSection("Docs", "write docs"),
        ])],
      ]);
      const override = makeProfile([
        ["how i work", makeSection("How I Work", "", [
          makeSection("Testing", "integration tests required"),
        ])],
      ]);

      const merged = mergeProfiles([base, override]);
      const howIWork = merged.sections.get("how i work");
      expect(howIWork).toBeDefined();

      const subTitles = howIWork!.subsections.map(s => s.normalizedTitle);
      const testingCount = subTitles.filter(t => t === "testing").length;
      expect(testingCount).toBe(1);
      expect(subTitles).toContain("docs");
    });

    it("override subsection content wins", () => {
      const base = makeProfile([
        ["me", makeSection("Me", "", [
          makeSection("Style", "base style"),
        ])],
      ]);
      const override = makeProfile([
        ["me", makeSection("Me", "", [
          makeSection("Style", "override style"),
        ])],
      ]);

      const merged = mergeProfiles([base, override]);
      const me = merged.sections.get("me");
      const style = me!.subsections.find(s => s.normalizedTitle === "style");
      expect(style!.content).toBe("override style");
    });
  });

  describe("basic merge behavior", () => {
    it("returns empty profile for empty array", () => {
      const merged = mergeProfiles([]);
      expect(merged.sections.size).toBe(0);
    });

    it("returns same profile for single-element array", () => {
      const profile = makeProfile([
        ["me", makeSection("Me", "test content")],
      ]);
      const merged = mergeProfiles([profile]);
      expect(merged.sections.get("me")?.content).toBe("test content");
    });
  });
});
