import { describe, it, expect } from "vitest";
import {
  parseVisibility,
  isVisible,
  visibilityFor,
  filterProfileForAudience,
  describeVisibility,
  VISIBILITY_VALUES,
  type Audience,
  type VisibilityAwareProfile,
} from "../../src/core/visibility";
import { createParser } from "../../src/parser";
import { formatProfileForContext } from "../../src/core/formatter";

const CODING_LOCAL: Audience = { kind: "coding", shared: false };
const CODING_SHARED: Audience = { kind: "coding", shared: true };
const PERSONAL_LOCAL: Audience = { kind: "personal", shared: false };
const PERSONAL_SHARED: Audience = { kind: "personal", shared: true };
const ALL = [CODING_LOCAL, CODING_SHARED, PERSONAL_LOCAL, PERSONAL_SHARED];

function section(title: string, content: string, subsections: { title: string; content: string }[] = []) {
  return { title, content, subsections };
}

function profile(
  visibility: unknown,
  sections: ReturnType<typeof section>[]
): VisibilityAwareProfile {
  const map = new Map<string, ReturnType<typeof section>>();
  for (const s of sections) map.set(s.title.toLowerCase(), s);
  const metadata: Record<string, unknown> = {};
  if (visibility !== undefined) metadata.visibility = visibility;
  return { metadata, sections: map };
}

describe("parseVisibility", () => {
  it("returns an empty map when frontmatter has no visibility key", () => {
    const map = parseVisibility({ schema_version: "1.1" });
    expect(map.rules.size).toBe(0);
    expect(map.invalid).toEqual([]);
    expect(map.malformed).toBe(false);
  });

  it("normalises titles case-insensitively and strips YAML key quotes", () => {
    const map = parseVisibility({
      visibility: { "  Boundaries ": "private", "\"What I'm Into\"": "personal", "'Context'": "coding" },
    });
    expect(map.rules.get("boundaries")).toBe("private");
    expect(map.rules.get("what i'm into")).toBe("personal");
    expect(map.rules.get("context")).toBe("coding");
  });

  it("accepts values in any case", () => {
    const map = parseVisibility({ visibility: { Context: " Personal " } });
    expect(map.rules.get("context")).toBe("personal");
  });

  it("fails closed on unknown values: reports them and treats the section as private", () => {
    const map = parseVisibility({ visibility: { Boundaries: "secret", Context: 42 } });
    expect(map.invalid).toEqual([
      { title: "Boundaries", value: "secret" },
      { title: "Context", value: "42" },
    ]);
    expect(map.rules.get("boundaries")).toBe("private");
    expect(map.rules.get("context")).toBe("private");
  });

  it("flags a visibility key that is not a map", () => {
    expect(parseVisibility({ visibility: "private" }).malformed).toBe(true);
    expect(parseVisibility({ visibility: ["Boundaries"] }).malformed).toBe(true);
    expect(parseVisibility({ visibility: null }).malformed).toBe(false);
  });
});

describe("isVisible", () => {
  it("everywhere reaches every audience", () => {
    for (const a of ALL) expect(isVisible("everywhere", a)).toBe(true);
  });

  it("coding reaches coding tools only, shared or not", () => {
    expect(isVisible("coding", CODING_LOCAL)).toBe(true);
    expect(isVisible("coding", CODING_SHARED)).toBe(true);
    expect(isVisible("coding", PERSONAL_LOCAL)).toBe(false);
    expect(isVisible("coding", PERSONAL_SHARED)).toBe(false);
  });

  it("personal reaches personal agents only, shared or not", () => {
    expect(isVisible("personal", PERSONAL_LOCAL)).toBe(true);
    expect(isVisible("personal", PERSONAL_SHARED)).toBe(true);
    expect(isVisible("personal", CODING_LOCAL)).toBe(false);
    expect(isVisible("personal", CODING_SHARED)).toBe(false);
  });

  it("private never leaves the machine, whatever the audience kind", () => {
    expect(isVisible("private", CODING_LOCAL)).toBe(true);
    expect(isVisible("private", PERSONAL_LOCAL)).toBe(true);
    expect(isVisible("private", CODING_SHARED)).toBe(false);
    expect(isVisible("private", PERSONAL_SHARED)).toBe(false);
  });

  it("has a description for every value", () => {
    for (const v of VISIBILITY_VALUES) expect(describeVisibility(v).length).toBeGreaterThan(0);
  });
});

describe("visibilityFor", () => {
  it("defaults to everywhere for sections that are not listed", () => {
    const map = parseVisibility({ visibility: { Boundaries: "private" } });
    expect(visibilityFor(map, "Boundaries")).toBe("private");
    expect(visibilityFor(map, "BOUNDARIES")).toBe("private");
    expect(visibilityFor(map, "How I Work")).toBe("everywhere");
  });
});

describe("filterProfileForAudience", () => {
  const sections = [
    section("How I Work", "Prefer TypeScript."),
    section("Code Review Preferences", "Flag security issues."),
    section("Context", "Timezone: Europe/Berlin"),
    section("Boundaries", "Never mention my health."),
  ];
  const visibility = {
    "Code Review Preferences": "coding",
    Context: "personal",
    Boundaries: "private",
  };

  it("returns the profile untouched when no visibility is declared", () => {
    const p = profile(undefined, sections);
    const { profile: out, hidden } = filterProfileForAudience(p, CODING_SHARED);
    expect(out).toBe(p);
    expect(hidden).toEqual([]);
  });

  it("keeps everything for a local coding tool except personal-only sections", () => {
    const { profile: out, hidden } = filterProfileForAudience(profile(visibility, sections), CODING_LOCAL);
    expect([...out.sections.keys()]).toEqual(["how i work", "code review preferences", "boundaries"]);
    expect(hidden).toEqual(["Context"]);
  });

  it("strips private and personal sections from a committed project file", () => {
    const { profile: out, hidden } = filterProfileForAudience(profile(visibility, sections), CODING_SHARED);
    expect([...out.sections.keys()]).toEqual(["how i work", "code review preferences"]);
    expect(hidden).toEqual(["Context", "Boundaries"]);
  });

  it("gives a local personal agent personal and private sections but not coding ones", () => {
    const { profile: out, hidden } = filterProfileForAudience(profile(visibility, sections), PERSONAL_LOCAL);
    expect([...out.sections.keys()]).toEqual(["how i work", "context", "boundaries"]);
    expect(hidden).toEqual(["Code Review Preferences"]);
  });

  it("gives a cloud personal agent only what is safe to hand over", () => {
    const { profile: out, hidden } = filterProfileForAudience(profile(visibility, sections), PERSONAL_SHARED);
    expect([...out.sections.keys()]).toEqual(["how i work", "context"]);
    expect(hidden).toEqual(["Code Review Preferences", "Boundaries"]);
  });

  it("filters nested subsections and reports them as Parent > Child", () => {
    const p = profile({ Testing: "coding", Family: "private" }, [
      section("How I Work", "Ship small.", [
        { title: "Testing", content: "pytest" },
        { title: "Family", content: "Two kids." },
        { title: "Hours", content: "9 to 5" },
      ]),
    ]);
    const { profile: out, hidden } = filterProfileForAudience(p, PERSONAL_SHARED);
    expect(out.sections.get("how i work")?.subsections.map(s => s.title)).toEqual(["Hours"]);
    expect(hidden).toEqual(["How I Work > Testing", "How I Work > Family"]);
  });

  it("does not mutate the original profile", () => {
    const p = profile(visibility, sections);
    filterProfileForAudience(p, CODING_SHARED);
    expect(p.sections.size).toBe(4);
  });

  it("treats a section with an unknown visibility value as private", () => {
    const p = profile({ Boundaries: "sekret" }, sections);
    expect(filterProfileForAudience(p, CODING_LOCAL).hidden).toEqual([]);
    expect(filterProfileForAudience(p, CODING_SHARED).hidden).toEqual(["Boundaries"]);
  });
});

describe("end to end through the parser and formatter", () => {
  const YOU_MD = `---
schema_version: "1.1"
visibility:
  Boundaries: private
  "What I'm Into": personal
  Code Review Preferences: coding
---

# Me

## How I Communicate

Verbosity: concise

## What I'm Into

Topics: trail running, synthesizers

## Code Review Preferences

- Flag security issues

## Boundaries

- Do not bring up my health
`;

  it("renders different text for a committed AGENTS.md and a cloud personal agent", () => {
    const parsed = createParser().parse(YOU_MD);
    expect(parsed.success).toBe(true);
    const p = parsed.profile as unknown as VisibilityAwareProfile;

    const agentsMd = formatProfileForContext(filterProfileForAudience(p, CODING_SHARED).profile);
    expect(agentsMd).toContain("## How I Communicate");
    expect(agentsMd).toContain("## Code Review Preferences");
    expect(agentsMd).not.toContain("trail running");
    expect(agentsMd).not.toContain("my health");

    const muse = formatProfileForContext(filterProfileForAudience(p, PERSONAL_SHARED).profile);
    expect(muse).toContain("## How I Communicate");
    expect(muse).toContain("trail running");
    expect(muse).not.toContain("Flag security issues");
    expect(muse).not.toContain("my health");

    const claudeGlobal = formatProfileForContext(filterProfileForAudience(p, CODING_LOCAL).profile);
    expect(claudeGlobal).toContain("my health");
    expect(claudeGlobal).not.toContain("trail running");
  });
});

describe("hidden report with an H1 wrapper", () => {
  it("names each held-back heading once even though the parser nests and flattens it", () => {
    const parsed = createParser().parse(
      '---\nschema_version: "1.1"\nvisibility:\n  Boundaries: private\n---\n\n# Me\n\n## How I Work\n\nShip small.\n\n## Boundaries\n\nNo health talk.\n'
    );
    const p = parsed.profile as unknown as VisibilityAwareProfile;
    const { profile: out, hidden } = filterProfileForAudience(p, { kind: "coding", shared: true });
    expect(hidden).toEqual(["Boundaries"]);
    expect(formatProfileForContext(out)).not.toContain("health");
  });
});
