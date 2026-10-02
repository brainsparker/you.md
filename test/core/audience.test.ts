import { describe, it, expect } from "vitest";
import {
  parseAudienceRule,
  findDirective,
  stripDirectives,
  audienceIncludes,
  expandAudiences,
  unknownAudiences,
  describeRule,
  audienceNames,
  scopeProfile,
  AUDIENCE_GROUPS,
  KNOWN_TARGET_IDS,
  MCP_TARGET_ID,
} from "../../src/core/audience";
import { EXPORT_TARGETS } from "../../src/cli/commands/export";
import { createParser } from "../../src/parser";
import { formatProfileForContext } from "../../src/core/formatter";

const PROFILE = `---
schema_version: "1.1"
---

# Me

## What I Do

Staff product manager on an AI developer platform.

## Health
<!-- you-md: private -->

Nut allergy. Ask before suggesting restaurants.

### Medication

Carries an epinephrine pen.

## How I Work
<!-- you-md: for coding -->

Prefer TypeScript in strict mode.

### Testing

Test behavior, not implementation details.

### Pairing
<!-- you-md: not cursor -->

Narrate reasoning while editing.

## What I'm Into
<!-- you-md: not dots, grok -->

Long-distance cycling, modular synths.
`;

function parsed() {
  const result = createParser().parse(PROFILE);
  expect(result.success).toBe(true);
  return result.profile;
}

describe("parseAudienceRule", () => {
  it("reads private as a for-local rule", () => {
    expect(parseAudienceRule("private")).toEqual({ kind: "for", audiences: ["local"], raw: "private" });
    expect(parseAudienceRule("  Private ")).toMatchObject({ kind: "for", audiences: ["local"] });
  });

  it("reads for and not with comma or space separated audiences", () => {
    expect(parseAudienceRule("for claude, cursor")).toMatchObject({ kind: "for", audiences: ["claude", "cursor"] });
    expect(parseAudienceRule("not dots grok")).toMatchObject({ kind: "not", audiences: ["dots", "grok"] });
    expect(parseAudienceRule("FOR Coding")).toMatchObject({ kind: "for", audiences: ["coding"] });
  });

  it("returns null for anything else", () => {
    expect(parseAudienceRule("hide")).toBeNull();
    expect(parseAudienceRule("for")).toBeNull();
    expect(parseAudienceRule("")).toBeNull();
    expect(parseAudienceRule("only claude")).toBeNull();
  });
});

describe("findDirective", () => {
  it("finds a directive on the first non-blank line", () => {
    expect(findDirective("\n\n<!-- you-md: private -->\nNut allergy.")).toMatchObject({
      raw: "private",
      rule: { kind: "for" },
    });
  });

  it("ignores comments that are not on the first line", () => {
    expect(findDirective("Some text.\n<!-- you-md: private -->")).toBeNull();
  });

  it("ignores ordinary HTML comments", () => {
    expect(findDirective("<!-- a note to myself -->\nText.")).toBeNull();
  });

  it("does not mistake managed-block markers for directives", () => {
    expect(findDirective("<!-- you-md:begin -->\nText.")).toBeNull();
    expect(findDirective("<!-- you-md:end -->")).toBeNull();
    expect(stripDirectives("<!-- you-md:begin -->\nText.\n<!-- you-md:end -->")).toBe(
      "<!-- you-md:begin -->\nText.\n<!-- you-md:end -->"
    );
  });

  it("reports an unreadable directive with a null rule", () => {
    expect(findDirective("<!-- you-md: hide -->\nText.")).toEqual({ raw: "hide", rule: null });
  });
});

describe("stripDirectives", () => {
  it("removes directive lines wherever they appear and trims", () => {
    const content = "<!-- you-md: private -->\n\nKeep this.\n<!--you-md: for coding-->\nAnd this.\n";
    expect(stripDirectives(content)).toBe("Keep this.\nAnd this.");
  });

  it("leaves other comments and content alone", () => {
    const content = "<!-- not ours -->\nText.";
    expect(stripDirectives(content)).toBe(content);
  });
});

describe("audience vocabulary", () => {
  it("knows every export target plus the mcp pseudo target", () => {
    const exportIds = EXPORT_TARGETS.map(t => t.id).sort();
    const known = KNOWN_TARGET_IDS.filter(id => id !== MCP_TARGET_ID).sort();
    expect(known).toEqual(exportIds);
  });

  it("puts every target in exactly one of local or cloud", () => {
    for (const id of KNOWN_TARGET_IDS) {
      const local = AUDIENCE_GROUPS.local.includes(id);
      const cloud = AUDIENCE_GROUPS.cloud.includes(id);
      expect(local !== cloud, `${id} should be local xor cloud`).toBe(true);
    }
  });

  it("marks cloud agents as cloud and file-reading tools as local", () => {
    for (const target of EXPORT_TARGETS) {
      const expected = target.handoff ? "cloud" : "local";
      expect(AUDIENCE_GROUPS[expected].includes(target.id), `${target.id} should be ${expected}`).toBe(true);
    }
  });

  it("expands groups and ids, ignoring unknown names", () => {
    expect(expandAudiences(["cloud"])).toEqual(new Set(["muse", "instinct", "dots", "grok"]));
    expect(expandAudiences(["claude", "nope"])).toEqual(new Set(["claude"]));
    expect(expandAudiences(["all"]).size).toBe(KNOWN_TARGET_IDS.length);
  });

  it("lists groups before target ids and hides the mcp pseudo target", () => {
    const names = audienceNames();
    expect(names.slice(0, 5)).toEqual(["all", "coding", "personal", "local", "cloud"]);
    expect(names).toContain("claude");
    expect(names).not.toContain(MCP_TARGET_ID);
  });

  it("reports unknown audiences", () => {
    expect(unknownAudiences(parseAudienceRule("for claude, clawd, cloud")!)).toEqual(["clawd"]);
  });

  it("describes rules for humans", () => {
    expect(describeRule(parseAudienceRule("private")!)).toBe("private");
    expect(describeRule(parseAudienceRule("for local")!)).toBe("private");
    expect(describeRule(parseAudienceRule("for coding")!)).toBe("for coding");
    expect(describeRule(parseAudienceRule("not dots, grok")!)).toBe("not dots, grok");
  });
});

describe("audienceIncludes", () => {
  it("includes everyone when there is no rule", () => {
    expect(audienceIncludes(null, "grok")).toBe(true);
    expect(audienceIncludes(undefined, "claude")).toBe(true);
  });

  it("keeps private sections away from cloud agents only", () => {
    const rule = parseAudienceRule("private")!;
    expect(audienceIncludes(rule, "claude")).toBe(true);
    expect(audienceIncludes(rule, "hermes")).toBe(true);
    expect(audienceIncludes(rule, MCP_TARGET_ID)).toBe(true);
    expect(audienceIncludes(rule, "muse")).toBe(false);
    expect(audienceIncludes(rule, "dots")).toBe(false);
  });

  it("applies for and not rules", () => {
    expect(audienceIncludes(parseAudienceRule("for cursor")!, "cursor")).toBe(true);
    expect(audienceIncludes(parseAudienceRule("for cursor")!, "claude")).toBe(false);
    expect(audienceIncludes(parseAudienceRule("not cursor")!, "cursor")).toBe(false);
    expect(audienceIncludes(parseAudienceRule("not cursor")!, "claude")).toBe(true);
  });

  it("sends a for-rule with only unknown names nowhere", () => {
    expect(audienceIncludes(parseAudienceRule("for clawd")!, "claude")).toBe(false);
  });
});

describe("scopeProfile", () => {
  it("gives coding tools the coding sections and private sections, but not cloud-only exclusions", () => {
    const { profile, withheld } = scopeProfile(parsed(), "claude");
    const text = formatProfileForContext(profile);
    expect(text).toContain("Nut allergy");
    expect(text).toContain("epinephrine");
    expect(text).toContain("strict mode");
    expect(text).toContain("Narrate reasoning");
    expect(text).toContain("modular synths");
    expect(withheld).toEqual([]);
  });

  it("withholds private and coding-only sections from cloud agents", () => {
    const { profile, withheld } = scopeProfile(parsed(), "muse");
    const text = formatProfileForContext(profile);
    expect(text).toContain("Staff product manager");
    expect(text).toContain("modular synths");
    expect(text).not.toContain("Nut allergy");
    expect(text).not.toContain("epinephrine");
    expect(text).not.toContain("strict mode");
    expect(text).not.toContain("Test behavior");
    expect(withheld).toEqual([
      { title: "Health", rule: "private" },
      { title: "How I Work", rule: "for coding" },
    ]);
  });

  it("applies not rules to the named targets only", () => {
    const grok = formatProfileForContext(scopeProfile(parsed(), "grok").profile);
    expect(grok).not.toContain("modular synths");
    const instinct = formatProfileForContext(scopeProfile(parsed(), "instinct").profile);
    expect(instinct).toContain("modular synths");
  });

  it("lets a subsection override its parent's rule", () => {
    const { profile, withheld } = scopeProfile(parsed(), "cursor");
    const text = formatProfileForContext(profile);
    expect(text).toContain("strict mode");
    expect(text).toContain("Test behavior");
    expect(text).not.toContain("Narrate reasoning");
    expect(withheld).toEqual([{ title: "Pairing", rule: "not cursor" }]);
  });

  it("never renders directive lines, even for targets that see everything", () => {
    for (const id of KNOWN_TARGET_IDS) {
      const text = formatProfileForContext(scopeProfile(parsed(), id).profile);
      expect(text, `directive leaked to ${id}`).not.toContain("you-md:");
    }
  });

  it("removes excluded sections from both the section map and nested lists", () => {
    const { profile } = scopeProfile(parsed(), "muse");
    expect(profile.sections.has("health")).toBe(false);
    expect(profile.sections.has("medication")).toBe(false);
    const me = profile.sections.get("me")!;
    expect(me.subsections.map(s => s.title)).toEqual(["What I Do", "What I'm Into"]);
  });

  it("reports only the top of an excluded subtree as withheld", () => {
    const { withheld } = scopeProfile(parsed(), "dots");
    expect(withheld.map(w => w.title)).toEqual(["Health", "How I Work", "What I'm Into"]);
  });

  it("leaves a profile without directives untouched", () => {
    const plain = createParser().parse('---\nschema_version: "1.1"\n---\n\n# Me\n\n## About\n\nHello.\n').profile;
    const { profile, withheld } = scopeProfile(plain, "grok");
    expect(withheld).toEqual([]);
    expect(formatProfileForContext(profile)).toBe(formatProfileForContext(plain));
  });

  it("works on hand-built profiles without nested subsections", () => {
    const sections = new Map([
      ["a", { title: "A", content: "<!-- you-md: private -->\nSecret." }],
      ["b", { title: "B", content: "Public." }],
    ]);
    const { profile, withheld } = scopeProfile({ sections, metadata: {} }, "grok");
    expect([...profile.sections.keys()]).toEqual(["b"]);
    expect(withheld).toEqual([{ title: "A", rule: "private" }]);
  });
});
