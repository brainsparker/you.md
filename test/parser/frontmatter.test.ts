import { describe, it, expect } from "vitest";
import { extractFrontmatter } from "../../src/parser/frontmatter";

describe("extractFrontmatter", () => {
  it("extracts valid frontmatter", () => {
    const input = `---
schema_version: "1.0"
author: "Test"
---

# Content here`;

    const result = extractFrontmatter(input);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toContain('schema_version: "1.0"');
    expect(result.frontmatter).toContain('author: "Test"');
    expect(result.content.trim()).toBe("# Content here");
  });

  it("handles missing frontmatter", () => {
    const input = "# Just markdown\n\nNo frontmatter here";

    const result = extractFrontmatter(input);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe(input);
  });

  it("handles empty input", () => {
    const result = extractFrontmatter("");

    expect(result.hasFrontmatter).toBe(false);
    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe("");
  });

  it("handles frontmatter with ... end marker", () => {
    const input = `---
schema_version: "1.0"
...

# Content`;

    const result = extractFrontmatter(input);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatter).toContain('schema_version: "1.0"');
  });

  it("handles BOM character", () => {
    const input = `\uFEFF---
schema_version: "1.0"
---

# Content`;

    const result = extractFrontmatter(input);

    expect(result.hasFrontmatter).toBe(true);
  });

  it("handles unclosed frontmatter", () => {
    const input = `---
schema_version: "1.0"
No closing delimiter`;

    const result = extractFrontmatter(input);

    expect(result.hasFrontmatter).toBe(false);
  });

  it("returns correct contentStartLine", () => {
    const input = `---
schema_version: "1.0"
author: "Test"
---

# Content`;

    const result = extractFrontmatter(input);

    expect(result.contentStartLine).toBe(5); // Line after ---
  });
});
