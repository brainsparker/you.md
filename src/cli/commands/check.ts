/**
 * you-md check — verify profile existence, validity, and tool installations
 *
 * Usage:
 *   you-md check         Show profile status and tool installations
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

import type { CliFlags } from "../args.js";
import { createParser } from "../../parser/index.js";
import { readJsonConfig } from "./skill.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckOptions {
  searchPaths?: string[];
  log?: (msg: string) => void;
}

export interface CheckResult {
  profileFound: boolean;
  profilePath: string | null;
  profileValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  sections: string[];
  toolsInstalled: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Default search paths
// ---------------------------------------------------------------------------

const HOME = homedir();

function defaultSearchPaths(): string[] {
  return [
    resolve(".you.md"),
    resolve("you.md"),
    resolve(HOME, ".you.md"),
    resolve(HOME, ".config", "you.md"),
  ];
}

// ---------------------------------------------------------------------------
// Tool config paths (mirrors skill.ts tool definitions)
// ---------------------------------------------------------------------------

interface ToolCheck {
  id: string;
  name: string;
  configPath: string;
}

function getToolChecks(): ToolCheck[] {
  const IS_MAC = process.platform === "darwin";
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      configPath: resolve(HOME, ".claude", "claude_desktop_config.json"),
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      configPath: IS_MAC
        ? resolve(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : resolve(HOME, ".config", "Claude", "claude_desktop_config.json"),
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: resolve(HOME, ".cursor", "mcp.json"),
    },
    {
      id: "windsurf",
      name: "Windsurf",
      configPath: resolve(HOME, ".codeium", "windsurf", "mcp_config.json"),
    },
  ];
}

// ---------------------------------------------------------------------------
// Core logic (testable)
// ---------------------------------------------------------------------------

export async function runCheck(options?: CheckOptions): Promise<CheckResult> {
  const log = options?.log ?? console.log;
  const searchPaths = options?.searchPaths ?? defaultSearchPaths();

  log("you.md check");
  log("\u2500".repeat(40));
  log("");

  // 1. Find profile
  let profilePath: string | null = null;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      profilePath = p;
      break;
    }
  }

  if (!profilePath) {
    log("✗ Profile not found");
    log("");
    log("  Searched:");
    for (const p of searchPaths) {
      log(`    ${p}`);
    }
    log("");
    log("  Create one with: npx you-md init -i");

    return {
      profileFound: false,
      profilePath: null,
      profileValid: false,
      validationErrors: [],
      validationWarnings: [],
      sections: [],
      toolsInstalled: {},
    };
  }

  // 2. Parse and validate
  const parser = createParser();
  const parseResult = await parser.loadFromPath(profilePath);

  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];
  let profileValid = parseResult.success;

  if (parseResult.success) {
    const validation = parser.validate(parseResult.profile);
    profileValid = validation.valid;
    for (const e of validation.errors) {
      validationErrors.push(`${e.code}: ${e.message}`);
    }
    for (const w of validation.warnings) {
      validationWarnings.push(`${w.code}: ${w.message}`);
    }
  } else {
    for (const e of parseResult.errors) {
      validationErrors.push(`${e.code}: ${e.message}`);
    }
  }

  log(`✓ Profile found: ${profilePath}`);

  if (profileValid) {
    const version = parseResult.profile.schemaVersion || "unknown";
    log(`✓ Profile is valid (schema v${version})`);
  } else {
    log("✗ Profile has validation errors:");
    for (const err of validationErrors) {
      log(`    ${err}`);
    }
  }

  if (validationWarnings.length > 0) {
    log("");
    log("  Warnings:");
    for (const w of validationWarnings) {
      log(`    ${w}`);
    }
  }

  // 3. List sections
  const sections: string[] = [];

  function collectSections(sectionMap: Map<string, { title: string; subsections: { title: string; subsections: any[] }[] }>, indent: number) {
    for (const [, section] of sectionMap) {
      sections.push(section.title);
      log(`${"  ".repeat(indent + 2)}${section.title}`);
      if (section.subsections && section.subsections.length > 0) {
        for (const sub of section.subsections) {
          sections.push(sub.title);
          log(`${"  ".repeat(indent + 3)}${sub.title}`);
        }
      }
    }
  }

  if (parseResult.profile.sections.size > 0) {
    log("");
    log("Sections defined:");
    collectSections(parseResult.profile.sections as any, 0);
  }

  // 4. Check tool installations
  const toolChecks = getToolChecks();
  const toolsInstalled: Record<string, boolean> = {};

  log("");
  log("Tool status:");

  for (const tool of toolChecks) {
    let installed = false;
    try {
      if (existsSync(tool.configPath)) {
        const config = await readJsonConfig(tool.configPath);
        const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
        installed = !!(mcpServers && "you-md" in mcpServers);
      }
    } catch {
      // Config unreadable — treat as not installed
    }
    toolsInstalled[tool.name] = installed;
    const icon = installed ? "✓" : "○";
    const label = installed ? "skill active" : "not installed";
    log(`    ${icon} ${tool.name.padEnd(18)} ${label}`);
  }

  return {
    profileFound: true,
    profilePath,
    profileValid,
    validationErrors,
    validationWarnings,
    sections,
    toolsInstalled,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function checkCommand(args: string[], flags: CliFlags): Promise<number> {
  const result = await runCheck();
  return result.profileValid ? 0 : 1;
}
