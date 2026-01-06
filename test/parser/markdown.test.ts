import { describe, it, expect } from "vitest";
import { extractSections, findSection, flattenSections } from "../../src/parser/markdown";

describe("extractSections", () => {
  it("extracts top-level sections", () => {
    const input = `
# Section One

Content for section one.

# Section Two

Content for section two.
`;

    const result = extractSections(input);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].title).toBe("Section One");
    expect(result.sections[1].title).toBe("Section Two");
  });

  it("extracts nested sections", () => {
    const input = `
# Main Section

## Subsection One

Content here.

## Subsection Two

More content.
`;

    const result = extractSections(input);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("Main Section");
    expect(result.sections[0].subsections).toHaveLength(2);
    expect(result.sections[0].subsections[0].title).toBe("Subsection One");
    expect(result.sections[0].subsections[1].title).toBe("Subsection Two");
  });

  it("parses key-value fields from content", () => {
    const input = `
# Preferences

Language: TypeScript
Framework: React
Enabled: true
`;

    const result = extractSections(input);
    const section = result.sections[0];

    expect(section.fields.get("language")?.value).toBe("TypeScript");
    expect(section.fields.get("framework")?.value).toBe("React");
    expect(section.fields.get("enabled")?.value).toBe(true);
  });

  it("parses list items", () => {
    const input = `
# Don't

- Add verbose explanations
- Skip tests
- Ignore errors
`;

    const result = extractSections(input);
    const section = result.sections[0];
    const items = section.fields.get("_items");

    expect(items?.value).toEqual([
      "Add verbose explanations",
      "Skip tests",
      "Ignore errors",
    ]);
  });

  it("normalizes section titles for lookup", () => {
    const input = `
# Technical Preferences

Content here.
`;

    const result = extractSections(input);

    expect(result.sections[0].normalizedTitle).toBe("technical preferences");
  });

  it("handles empty input", () => {
    const result = extractSections("");

    expect(result.sections).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles content without sections", () => {
    const input = "Just some text without any headers.";

    const result = extractSections(input);

    expect(result.sections).toHaveLength(0);
  });
});

describe("findSection", () => {
  it("finds section by title (case-insensitive)", () => {
    const input = `
# Technical Preferences

Content here.
`;

    const result = extractSections(input);
    const section = findSection(result.sections, "technical preferences");

    expect(section).toBeDefined();
    expect(section?.title).toBe("Technical Preferences");
  });

  it("finds nested sections", () => {
    const input = `
# Main

## Nested Section

Content.
`;

    const result = extractSections(input);
    const section = findSection(result.sections, "Nested Section");

    expect(section).toBeDefined();
    expect(section?.title).toBe("Nested Section");
  });

  it("returns undefined for non-existent section", () => {
    const input = `# Existing Section`;

    const result = extractSections(input);
    const section = findSection(result.sections, "Non-existent");

    expect(section).toBeUndefined();
  });
});

describe("flattenSections", () => {
  it("flattens nested sections into map", () => {
    const input = `
# Main

## Sub One

## Sub Two

### Deep Nested
`;

    const result = extractSections(input);
    const flat = flattenSections(result.sections);

    expect(flat.size).toBe(4);
    expect(flat.has("main")).toBe(true);
    expect(flat.has("sub one")).toBe(true);
    expect(flat.has("sub two")).toBe(true);
    expect(flat.has("deep nested")).toBe(true);
  });
});
