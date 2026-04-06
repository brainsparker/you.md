import { describe, it, expect } from "vitest";
import {
  getIdentityTemplate,
  getDeveloperTemplate,
  getMinimalTemplate,
  getPersonalizationTemplate,
} from "../../src/cli/templates/default.js";
import { CURRENT_SCHEMA_VERSION } from "../../src/utils/constants.js";

describe("templates use current schema version", () => {
  it("identity template", () => {
    expect(getIdentityTemplate()).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });
  it("developer template", () => {
    expect(getDeveloperTemplate()).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });
  it("minimal template", () => {
    expect(getMinimalTemplate()).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });
  it("personalization template", () => {
    expect(getPersonalizationTemplate()).toContain(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  });
});
