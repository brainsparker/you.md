import { describe, it, expect } from "vitest";
import { KNOWN_SECTIONS } from "../../src/utils/constants.js";

describe("known sections include new section names", () => {
  it("recognizes 'how i work'", () => {
    expect(KNOWN_SECTIONS).toContain("how i work");
  });
  it("recognizes 'where i\\'m headed'", () => {
    expect(KNOWN_SECTIONS).toContain("where i'm headed");
  });
  it("recognizes 'where im headed'", () => {
    expect(KNOWN_SECTIONS).toContain("where im headed");
  });
  it("recognizes 'boundaries'", () => {
    expect(KNOWN_SECTIONS).toContain("boundaries");
  });
});
