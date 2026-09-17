import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";

import { createParser } from "../../src/parser";
import {
  resolveExtendsTarget,
  canonicalSourceKey,
  remoteExtendsAllowed,
  maxExtendsDepth,
} from "../../src/core/inheritance";
import { formatProfileForContext } from "../../src/core/formatter";
import { REMOTE_EXTENDS_ENV_VAR } from "../../src/utils/constants";

const fixturesDir = resolve(__dirname, "../../fixtures/extends");

function profile(frontmatter: string, body: string): string {
  return `---\nschema_version: "1.1"\n${frontmatter}\n---\n\n${body}`;
}

describe("resolveExtendsTarget", () => {
  const parentFile = { kind: "path" as const, value: "/home/me/projects/app/.you.md" };
  const parentUrl = { kind: "url" as const, value: "https://example.com/team/profile.md" };

  it("resolves relative paths against the declaring file's directory", () => {
    const r = resolveExtendsTarget("../shared.you.md", parentFile);
    expect(r).toEqual({ ok: true, source: { kind: "path", value: "/home/me/projects/shared.you.md" } });
  });

  it("expands ~ to the home directory", () => {
    const r = resolveExtendsTarget("~/.you.md", parentFile);
    expect(r).toEqual({ ok: true, source: { kind: "path", value: resolve(homedir(), ".you.md") } });
  });

  it("keeps absolute paths", () => {
    const r = resolveExtendsTarget("/etc/you/base.md", parentFile);
    expect(r).toEqual({ ok: true, source: { kind: "path", value: "/etc/you/base.md" } });
  });

  it("passes HTTPS URLs through", () => {
    const r = resolveExtendsTarget("https://example.com/base.md", parentFile);
    expect(r).toEqual({ ok: true, source: { kind: "url", value: "https://example.com/base.md" } });
  });

  it("rejects non-HTTPS URLs", () => {
    const r = resolveExtendsTarget("http://example.com/base.md", parentFile);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EXTENDS_INVALID");
  });

  it("rejects empty and non-string values", () => {
    for (const bad of ["", "   ", 42, true, ["a"], { a: 1 }]) {
      const r = resolveExtendsTarget(bad, parentFile);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("EXTENDS_INVALID");
    }
  });

  it("resolves URL-relative references inside a remote profile", () => {
    const r = resolveExtendsTarget("../company.md", parentUrl);
    expect(r).toEqual({ ok: true, source: { kind: "url", value: "https://example.com/company.md" } });
  });

  it("refuses filesystem paths inside a remote profile", () => {
    for (const bad of ["/etc/passwd", "~/.you.md"]) {
      const r = resolveExtendsTarget(bad, parentUrl);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("EXTENDS_INVALID");
    }
  });
});

describe("inheritance helpers", () => {
  const savedEnv = process.env[REMOTE_EXTENDS_ENV_VAR];

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[REMOTE_EXTENDS_ENV_VAR];
    else process.env[REMOTE_EXTENDS_ENV_VAR] = savedEnv;
  });

  it("remote bases are off unless opted in", () => {
    delete process.env[REMOTE_EXTENDS_ENV_VAR];
    expect(remoteExtendsAllowed()).toBe(false);
    expect(remoteExtendsAllowed({ allowRemoteExtends: true })).toBe(true);
    process.env[REMOTE_EXTENDS_ENV_VAR] = "1";
    expect(remoteExtendsAllowed()).toBe(true);
    process.env[REMOTE_EXTENDS_ENV_VAR] = "TRUE";
    expect(remoteExtendsAllowed()).toBe(true);
    process.env[REMOTE_EXTENDS_ENV_VAR] = "0";
    expect(remoteExtendsAllowed()).toBe(false);
    // An explicit option beats the environment either way.
    process.env[REMOTE_EXTENDS_ENV_VAR] = "1";
    expect(remoteExtendsAllowed({ allowRemoteExtends: false })).toBe(false);
  });

  it("falls back to the default depth for missing or nonsense values", () => {
    expect(maxExtendsDepth()).toBe(5);
    expect(maxExtendsDepth({ maxExtendsDepth: 2 })).toBe(2);
    expect(maxExtendsDepth({ maxExtendsDepth: -1 })).toBe(5);
    expect(maxExtendsDepth({ maxExtendsDepth: Number.NaN })).toBe(5);
  });

  it("canonicalizes symlinked paths to the same key", () => {
    const dir = mkdtempSync(join(tmpdir(), "you-md-canon-"));
    try {
      const real = join(dir, "base.md");
      writeFileSync(real, profile("", "# Me\n"));
      const link = join(dir, "link.md");
      symlinkSync(real, link);
      expect(canonicalSourceKey({ kind: "path", value: link })).toBe(
        canonicalSourceKey({ kind: "path", value: real })
      );
      expect(canonicalSourceKey({ kind: "url", value: "https://a/b" })).toBe("url:https://a/b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parser extends resolution", () => {
  const parser = createParser();
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "you-md-extends-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("merges the fixture base underneath the project profile", async () => {
    const result = await parser.loadFromPath(join(fixturesDir, "project.md"));

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.profile.extendsChain).toEqual([join(fixturesDir, "base.md")]);

    // Inherited from the base only
    expect(result.profile.sections.has("how i work")).toBe(true);
    expect(result.profile.sections.has("boundaries")).toBe(true);
    // Declared in the project only
    expect(result.profile.sections.has("project conventions")).toBe(true);

    // Overlapping section: the project's content wins, base-only fields survive
    const comms = result.profile.sections.get("how i communicate")!;
    expect(comms.content).toContain("detailed");
    expect(comms.content).not.toContain("concise");
    expect(comms.fields.get("verbosity")?.value).toBe("detailed");
    expect(comms.fields.get("tone")?.value).toBe("direct");

    // Metadata: declaring file wins, base fills gaps
    expect(result.profile.metadata.author).toBe("Project");
    expect(result.profile.metadata.privacyLevel).toBe("private");
    expect(result.profile.metadata.extends).toBe("./base.md");

    // The declaring file keeps its own identity
    expect(result.profile.sourcePath).toBe(join(fixturesDir, "project.md"));
    expect(result.profile.rawContent).toContain('extends: "./base.md"');
    expect(result.profile.rawContent).not.toContain("Do not put secrets");

    // What tools receive includes the inherited sections
    const formatted = formatProfileForContext(result.profile);
    expect(formatted).toContain("## Boundaries");
    expect(formatted).toContain("## Project Conventions");
  });

  it("walks a multi-level chain root-most first", async () => {
    writeFileSync(join(dir, "company.md"), profile('author: "Company"', "# Me\n\n## Boundaries\n\n- Company rule\n\n## Stack\n\nLanguage: Go\n"));
    writeFileSync(join(dir, "team.md"), profile('extends: "./company.md"', "# Me\n\n## Stack\n\nLanguage: TypeScript\n"));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", ".you.md"), profile('extends: "../team.md"', "# Me\n\n## Project\n\n- App rule\n"));

    const result = await parser.loadFromPath(join(dir, "app", ".you.md"));

    expect(result.success).toBe(true);
    expect(result.profile.extendsChain).toEqual([join(dir, "company.md"), join(dir, "team.md")]);
    expect(result.profile.sections.get("boundaries")?.content).toContain("Company rule");
    expect(result.profile.sections.get("stack")?.fields.get("language")?.value).toBe("TypeScript");
    expect(result.profile.sections.get("project")?.content).toContain("App rule");
    expect(result.profile.metadata.author).toBe("Company");
  });

  it("leaves the file as written when resolveExtends is false", async () => {
    const result = await parser.loadFromPath(join(fixturesDir, "project.md"), { resolveExtends: false });

    expect(result.success).toBe(true);
    expect(result.profile.extendsChain).toBeUndefined();
    expect(result.profile.sections.has("boundaries")).toBe(false);
    expect(result.profile.metadata.author).toBe("Project");
  });

  it("does nothing for profiles without extends", async () => {
    const result = await parser.loadFromPath(join(fixturesDir, "base.md"));
    expect(result.success).toBe(true);
    expect(result.profile.extendsChain).toBeUndefined();
  });

  it("reports a missing base", async () => {
    writeFileSync(join(dir, ".you.md"), profile('extends: "./nope.md"', "# Me\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"));

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("EXTENDS_NOT_FOUND");
    expect(result.errors[0].message).toContain(join(dir, "nope.md"));
    // The declaring profile is still returned for inspection
    expect(result.profile.sourcePath).toBe(join(dir, ".you.md"));
  });

  it("reports a base that fails to parse", async () => {
    writeFileSync(join(dir, "base.md"), "# No frontmatter here\n");
    writeFileSync(join(dir, ".you.md"), profile('extends: "./base.md"', "# Me\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"));

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("EXTENDS_NOT_FOUND");
    expect(result.errors[0].message).toContain("schema_version");
  });

  it("detects direct and indirect cycles", async () => {
    writeFileSync(join(dir, "a.md"), profile('extends: "./b.md"', "# A\n"));
    writeFileSync(join(dir, "b.md"), profile('extends: "./c.md"', "# B\n"));
    writeFileSync(join(dir, "c.md"), profile('extends: "./a.md"', "# C\n"));
    writeFileSync(join(dir, "self.md"), profile('extends: "./self.md"', "# Self\n"));

    const indirect = await parser.loadFromPath(join(dir, "a.md"));
    expect(indirect.success).toBe(false);
    expect(indirect.errors[0].code).toBe("EXTENDS_CYCLE");

    const direct = await parser.loadFromPath(join(dir, "self.md"));
    expect(direct.success).toBe(false);
    expect(direct.errors[0].code).toBe("EXTENDS_CYCLE");
  });

  it("enforces the depth limit", async () => {
    writeFileSync(join(dir, "root.md"), profile("", "# Root\n"));
    writeFileSync(join(dir, "mid.md"), profile('extends: "./root.md"', "# Mid\n"));
    writeFileSync(join(dir, "leaf.md"), profile('extends: "./mid.md"', "# Leaf\n"));

    const ok = await parser.loadFromPath(join(dir, "leaf.md"), { maxExtendsDepth: 2 });
    expect(ok.success).toBe(true);
    expect(ok.profile.extendsChain).toHaveLength(2);

    const tooDeep = await parser.loadFromPath(join(dir, "leaf.md"), { maxExtendsDepth: 1 });
    expect(tooDeep.success).toBe(false);
    expect(tooDeep.errors[0].code).toBe("EXTENDS_DEPTH_EXCEEDED");
  });

  it("rejects an invalid extends value", async () => {
    writeFileSync(join(dir, ".you.md"), profile("extends: 42", "# Me\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"));

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("EXTENDS_INVALID");
  });

  it("refuses remote bases unless opted in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    writeFileSync(join(dir, ".you.md"), profile('extends: "https://example.com/team.md"', "# Me\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"), { allowRemoteExtends: false });

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("EXTENDS_REMOTE_DISABLED");
    expect(result.errors[0].message).toContain(REMOTE_EXTENDS_ENV_VAR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads remote bases when allowed and resolves URL-relative chains", async () => {
    const remote: Record<string, string> = {
      "https://example.com/team/profile.md": profile('extends: "../company.md"', "# Me\n\n## Team\n\n- Team rule\n"),
      "https://example.com/company.md": profile('author: "Company"', "# Me\n\n## Company\n\n- Company rule\n"),
    };
    const fetchMock = vi.fn(async (input: string | URL) => {
      const body = remote[String(input)];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    writeFileSync(join(dir, ".you.md"), profile('extends: "https://example.com/team/profile.md"', "# Me\n\n## Project\n\n- Local rule\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"), { allowRemoteExtends: true });

    expect(result.success).toBe(true);
    expect(result.profile.extendsChain).toEqual([
      "https://example.com/company.md",
      "https://example.com/team/profile.md",
    ]);
    expect(result.profile.sections.has("company")).toBe(true);
    expect(result.profile.sections.has("team")).toBe(true);
    expect(result.profile.sections.has("project")).toBe(true);
    expect(result.profile.metadata.author).toBe("Company");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a filesystem path declared by a remote base", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(profile('extends: "~/.you.md"', "# Remote\n"), { status: 200 }))
    );
    writeFileSync(join(dir, ".you.md"), profile('extends: "https://example.com/team.md"', "# Me\n"));

    const result = await parser.loadFromPath(join(dir, ".you.md"), { allowRemoteExtends: true });

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe("EXTENDS_INVALID");
  });

  it("resolves extends during discovery", async () => {
    writeFileSync(join(dir, "base.md"), profile("", "# Me\n\n## Inherited\n\n- From base\n"));
    writeFileSync(join(dir, ".you.md"), profile('extends: "./base.md"', "# Me\n\n## Local\n\n- Local\n"));

    const result = await parser.discover({ path: join(dir, ".you.md") });

    expect(result?.success).toBe(true);
    expect(result?.profile.sections.has("inherited")).toBe(true);
    expect(result?.profile.extendsChain).toEqual([join(dir, "base.md")]);
  });
});
