import { describe, it, expect } from "vitest";
import { parseYaml } from "../../src/parser/yaml";

describe("parseYaml", () => {
  it("parses simple key-value pairs", () => {
    const input = `
schema_version: "1.0"
author: Test User
count: 42
`;

    const result = parseYaml(input);

    expect(result.data.schema_version).toBe("1.0");
    expect(result.data.author).toBe("Test User");
    expect(result.data.count).toBe(42);
    expect(result.errors).toHaveLength(0);
  });

  it("parses booleans", () => {
    const input = `
enabled: true
disabled: false
yes_val: yes
no_val: no
`;

    const result = parseYaml(input);

    expect(result.data.enabled).toBe(true);
    expect(result.data.disabled).toBe(false);
    expect(result.data.yes_val).toBe(true);
    expect(result.data.no_val).toBe(false);
  });

  it("parses null values", () => {
    const input = `
empty: null
tilde: ~
`;

    const result = parseYaml(input);

    expect(result.data.empty).toBeNull();
    expect(result.data.tilde).toBeNull();
  });

  it("parses inline arrays", () => {
    const input = `tags: [coding, python, typescript]`;

    const result = parseYaml(input);

    expect(result.data.tags).toEqual(["coding", "python", "typescript"]);
  });

  it("parses block arrays", () => {
    const input = `
languages:
  - Python
  - TypeScript
  - Rust
`;

    const result = parseYaml(input);

    expect(result.data.languages).toEqual(["Python", "TypeScript", "Rust"]);
  });

  it("parses nested objects", () => {
    const input = `
metadata:
  author: Test
  version: 1.0
`;

    const result = parseYaml(input);

    expect(result.data.metadata).toEqual({
      author: "Test",
      version: 1.0,
    });
  });

  it("parses quoted strings", () => {
    const input = `
single: 'hello world'
double: "hello world"
`;

    const result = parseYaml(input);

    expect(result.data.single).toBe("hello world");
    expect(result.data.double).toBe("hello world");
  });

  it("handles comments", () => {
    const input = `
# This is a comment
key: value # inline comment
`;

    const result = parseYaml(input);

    expect(result.data.key).toBe("value");
  });

  it("parses inline objects", () => {
    const input = `style: {indent: 2, tabs: false}`;

    const result = parseYaml(input);

    expect(result.data.style).toEqual({
      indent: 2,
      tabs: false,
    });
  });

  it("handles empty input", () => {
    const result = parseYaml("");

    expect(result.data).toEqual({});
    expect(result.errors).toHaveLength(0);
  });

  it("parses dates as strings", () => {
    const input = `created: 2025-01-06`;

    const result = parseYaml(input);

    expect(result.data.created).toBe("2025-01-06");
  });

  it("parses float numbers", () => {
    const input = `version: 1.5`;

    const result = parseYaml(input);

    expect(result.data.version).toBe(1.5);
  });
});
