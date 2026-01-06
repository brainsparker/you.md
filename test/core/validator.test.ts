import { describe, it, expect } from "vitest";
import { validateProfile, isValidProfile } from "../../src/core/validator";
import { createEmptyProfile } from "../../src/types/profile";
import type { YouMdProfile } from "../../src/types/profile";

describe("validateProfile", () => {
  it("validates profile with correct schema version", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: { schemaVersion: "1.0" },
      sections: new Map(),
      rawContent: "---\nschema_version: '1.0'\n---\n",
    };

    const result = validateProfile(profile);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing schema version", () => {
    const profile: YouMdProfile = {
      schemaVersion: "",
      metadata: { schemaVersion: "" },
      sections: new Map(),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_SCHEMA_VERSION")).toBe(
      true
    );
  });

  it("rejects invalid schema version format", () => {
    const profile: YouMdProfile = {
      schemaVersion: "invalid",
      metadata: { schemaVersion: "invalid" },
      sections: new Map(),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_SCHEMA_VERSION")).toBe(
      true
    );
  });

  it("rejects unsupported schema version", () => {
    const profile: YouMdProfile = {
      schemaVersion: "99.0",
      metadata: { schemaVersion: "99.0" },
      sections: new Map(),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "UNSUPPORTED_SCHEMA_VERSION")
    ).toBe(true);
  });

  it("warns about unknown sections", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: { schemaVersion: "1.0" },
      sections: new Map([
        [
          "unknown section",
          {
            title: "Unknown Section",
            normalizedTitle: "unknown section",
            level: 2,
            content: "Some content",
            fields: new Map(),
            subsections: [],
          },
        ],
      ]),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.warnings.some((w) => w.code === "UNKNOWN_SECTION")).toBe(true);
  });

  it("warns about invalid date format", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: {
        schemaVersion: "1.0",
        created: "invalid-date",
      },
      sections: new Map(),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.warnings.some((w) => w.code === "INVALID_DATE_FORMAT")).toBe(
      true
    );
  });

  it("accepts valid date formats", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: {
        schemaVersion: "1.0",
        created: "2025-01-06",
        lastUpdated: "2025-01-06T12:00:00Z",
      },
      sections: new Map(),
      rawContent: "",
    };

    const result = validateProfile(profile);

    expect(result.warnings.filter((w) => w.code === "INVALID_DATE_FORMAT")).toHaveLength(0);
  });

  it("warns about possible sensitive data", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: { schemaVersion: "1.0" },
      sections: new Map(),
      rawContent: "api_key: sk-1234567890",
    };

    const result = validateProfile(profile);

    expect(result.warnings.some((w) => w.code === "POSSIBLE_SENSITIVE_DATA")).toBe(
      true
    );
  });
});

describe("isValidProfile", () => {
  it("returns true for valid profile", () => {
    const profile: YouMdProfile = {
      schemaVersion: "1.0",
      metadata: { schemaVersion: "1.0" },
      sections: new Map(),
      rawContent: "",
    };

    expect(isValidProfile(profile)).toBe(true);
  });

  it("returns false for invalid profile", () => {
    const profile: YouMdProfile = {
      schemaVersion: "",
      metadata: { schemaVersion: "" },
      sections: new Map(),
      rawContent: "",
    };

    expect(isValidProfile(profile)).toBe(false);
  });
});
