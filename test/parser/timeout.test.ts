import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser/index.js";

describe("parse timeout enforcement", () => {
  it("succeeds within reasonable timeout", () => {
    const parser = createParser();
    const result = parser.parse(`---\nschema_version: "1.1"\n---\n\n# Me\n`, {
      maxParseTime: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("returns PARSE_TIMEOUT error when timeout is 0ms", () => {
    const parser = createParser();
    const content = `---\nschema_version: "1.1"\n---\n\n# Me\nSome content here.\n`;

    const result = parser.parse(content, { maxParseTime: 0 });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "PARSE_TIMEOUT")).toBe(true);
  });

  it("works normally without maxParseTime option", () => {
    const parser = createParser();
    const result = parser.parse(`---\nschema_version: "1.1"\n---\n\n# Me\n`);
    expect(result.success).toBe(true);
  });
});
