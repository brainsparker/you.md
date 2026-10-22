/**
 * you-md skill — install, manage, and check the you.md skill across AI tools
 *
 * Usage:
 *   you-md skill install          Auto-detect and install into all supported tools
 *   you-md skill install cursor   Install into a specific tool only
 *   you-md skill status           Show which tools have the skill installed
 *   you-md skill uninstall        Remove from all tools
 *
 * Supported tools:
 *   claude-code     Claude Code (~/.claude/claude_desktop_config.json)
 *   claude-desktop  Claude Desktop (macOS ~/Library/Application Support/Claude/...)
 *   cursor          Cursor (~/.cursor/mcp.json)
 *   windsurf        Windsurf (~/.codeium/windsurf/mcp_config.json)
 *   codex           Codex CLI (~/.codex/config.toml, or $CODEX_HOME/config.toml)
 *   gemini          Gemini CLI (~/.gemini/settings.json, or $GEMINI_CLI_HOME/.gemini/settings.json)
 *
 * Codex keeps its config in TOML, not JSON. The server lands as a
 * `[mcp_servers.you-md]` table and the rest of the file is left byte for byte
 * as it was, so hand-written comments and other servers survive.
 */

import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir, platform } from "node:os"
import type { CliFlags } from "../args.js"

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
  id: string
  name: string
  configPath: string
  /** Config file format. JSON tools nest the entry under mcpKey; TOML tools get a table. */
  format: "json" | "toml"
  /** The JSON key path where mcpServers lives, e.g. ["mcpServers"] (JSON tools only) */
  mcpKey: string[]
  /** True if the config file must exist for the tool to be "detected" */
  requiresExisting: boolean
  /** Paths to check to confirm the tool is installed */
  installHints: string[]
}

const HOME = homedir()
const IS_MAC = platform() === "darwin"

/** Non-empty environment override, or undefined. */
function envDir(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? resolve(value) : undefined
}

// Codex honors CODEX_HOME as a replacement for ~/.codex. Gemini CLI honors
// GEMINI_CLI_HOME as a replacement for the home dir (it still appends .gemini).
const CODEX_DIR = envDir("CODEX_HOME") ?? resolve(HOME, ".codex")
const GEMINI_DIR = resolve(envDir("GEMINI_CLI_HOME") ?? HOME, ".gemini")

const TOOLS: ToolDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    configPath: resolve(HOME, ".claude", "claude_desktop_config.json"),
    format: "json",
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: [
      resolve(HOME, ".claude"),
      "/usr/local/bin/claude",
    ],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    configPath: IS_MAC
      ? resolve(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : resolve(HOME, ".config", "Claude", "claude_desktop_config.json"),
    format: "json",
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: IS_MAC
      ? ["/Applications/Claude.app"]
      : [resolve(HOME, ".config", "Claude")],
  },
  {
    id: "cursor",
    name: "Cursor",
    configPath: resolve(HOME, ".cursor", "mcp.json"),
    format: "json",
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: IS_MAC
      ? ["/Applications/Cursor.app", resolve(HOME, ".cursor")]
      : [resolve(HOME, ".cursor"), "/usr/local/bin/cursor"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    configPath: resolve(HOME, ".codeium", "windsurf", "mcp_config.json"),
    format: "json",
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: IS_MAC
      ? ["/Applications/Windsurf.app", resolve(HOME, ".codeium")]
      : [resolve(HOME, ".codeium"), "/usr/local/bin/windsurf"],
  },
  {
    id: "codex",
    name: "Codex CLI",
    configPath: resolve(CODEX_DIR, "config.toml"),
    format: "toml",
    mcpKey: [],
    requiresExisting: false,
    installHints: [CODEX_DIR, "/usr/local/bin/codex", "/opt/homebrew/bin/codex"],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    configPath: resolve(GEMINI_DIR, "settings.json"),
    format: "json",
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: [GEMINI_DIR, "/usr/local/bin/gemini", "/opt/homebrew/bin/gemini"],
  },
]

// The MCP server entry to inject. The npm package is scoped
// (@brainsparker/you-md); the "you-md" key in mcpServers and the
// you-md-mcp bin name are unchanged.
const MCP_ENTRY = {
  command: "npx",
  args: ["-y", "-p", "@brainsparker/you-md", "you-md-mcp"],
}

// ---------------------------------------------------------------------------
// TOML helpers (Codex CLI)
// ---------------------------------------------------------------------------

/**
 * The Codex table we own. Codex waits startup_timeout_sec (default 10) for a
 * stdio server to come up; npx fetching the package on first run can take
 * longer than that, so the entry asks for 30 seconds.
 */
export const CODEX_TABLE = [
  "[mcp_servers.you-md]",
  `command = ${JSON.stringify(MCP_ENTRY.command)}`,
  `args = [${MCP_ENTRY.args.map(a => JSON.stringify(a)).join(", ")}]`,
  "# npx may download the package on first launch; the Codex default of 10s is too short for that.",
  "startup_timeout_sec = 30",
].join("\n")

/** Matches [mcp_servers.you-md] and any sub-table such as [mcp_servers.you-md.env]. */
const OUR_TABLE_RE = /^\s*\[\s*mcp_servers\s*\.\s*("you-md"|'you-md'|you-md)\s*(\.[^\]]*)?\]\s*(#.*)?$/
/** Matches any table or array-of-tables header. */
const ANY_TABLE_RE = /^\s*\[/

/**
 * Locate the line range [start, end) owned by you-md in a Codex config: our
 * table header plus everything until the next unrelated table header.
 * Returns null when the table is absent.
 */
function findCodexTable(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex(l => OUR_TABLE_RE.test(l))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (ANY_TABLE_RE.test(line) && !OUR_TABLE_RE.test(line)) break
    end++
  }
  // Leave the blank lines that separate us from what follows (or the final
  // newline) outside the range, so replacing the table keeps the file shape.
  while (end > start + 1 && lines[end - 1].trim() === "") end--
  return { start, end }
}

export function hasCodexEntry(toml: string): boolean {
  return findCodexTable(toml.split(/\r?\n/)) !== null
}

/**
 * Insert or replace the you-md table. Everything outside the table is kept
 * exactly as written, including comments and other servers.
 */
export function upsertCodexEntry(toml: string, table: string = CODEX_TABLE): string {
  const lines = toml.split(/\r?\n/)
  const range = findCodexTable(lines)
  const block = table.split("\n")

  if (range) {
    // Keep one trailing blank line between us and whatever follows.
    const tail = lines.slice(range.end)
    const head = lines.slice(0, range.start)
    const sep = tail.length > 0 && tail[0].trim() !== "" ? [""] : []
    return [...head, ...block, ...sep, ...tail].join("\n")
  }

  const trimmed = toml.replace(/\s+$/, "")
  if (trimmed.length === 0) return block.join("\n") + "\n"
  return trimmed + "\n\n" + block.join("\n") + "\n"
}

/** Remove the you-md table. Returns the input unchanged when it is absent. */
export function removeCodexEntry(toml: string): string {
  const lines = toml.split(/\r?\n/)
  const range = findCodexTable(lines)
  if (!range) return toml
  const head = lines.slice(0, range.start)
  const tail = lines.slice(range.end)
  // Collapse the blank line that separated us from the previous table.
  while (head.length > 0 && head[head.length - 1].trim() === "" && (tail.length === 0 || tail[0].trim() === "")) {
    head.pop()
  }
  const out = [...head, ...tail].join("\n").replace(/\s+$/, "")
  return out.length === 0 ? "" : out + "\n"
}

async function readTextConfig(path: string): Promise<string> {
  if (!existsSync(path)) return ""
  const raw = await readFile(path, "utf-8")
  return raw.replace(/^\uFEFF/, "")
}

async function writeTextConfig(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (existsSync(path)) {
    await copyFile(path, path + ".backup")
  }
  const tmp = path + ".tmp"
  await writeFile(tmp, data, "utf-8")
  await rename(tmp, path)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isToolDetected(tool: ToolDef): boolean {
  return tool.installHints.some(p => existsSync(p))
}

export async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  const raw = await readFile(path, "utf-8")
  const normalized = raw.replace(/^\uFEFF/, "").trim()
  if (normalized.length === 0) return {}

  const parsed = JSON.parse(normalized) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError("Config JSON root must be an object")
  }

  return parsed as Record<string, unknown>
}

export async function writeJsonConfig(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (existsSync(path)) {
    await copyFile(path, path + ".backup")
  }
  const tmp = path + ".tmp"
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8")
  await rename(tmp, path)
}


function hasYouMdInstalled(config: Record<string, unknown>, tool: ToolDef): boolean {
  let cur: unknown = config
  for (const k of tool.mcpKey) {
    if (typeof cur !== "object" || cur === null) return false
    cur = (cur as Record<string, unknown>)[k]
  }
  if (typeof cur !== "object" || cur === null) return false
  return "you-md" in (cur as Record<string, unknown>)
}

async function isInstalled(tool: ToolDef): Promise<boolean> {
  if (tool.format === "toml") return hasCodexEntry(await readTextConfig(tool.configPath))
  return hasYouMdInstalled(await readJsonConfig(tool.configPath), tool)
}

async function installIntoTool(tool: ToolDef): Promise<"installed" | "already" | "error"> {
  try {
    if (tool.format === "toml") {
      const toml = await readTextConfig(tool.configPath)
      if (hasCodexEntry(toml)) return "already"
      await writeTextConfig(tool.configPath, upsertCodexEntry(toml))
      return "installed"
    }

    const config = await readJsonConfig(tool.configPath)
    if (hasYouMdInstalled(config, tool)) return "already"

    // Navigate/create the nested key path and inject
    let cur: Record<string, unknown> = config
    for (const k of tool.mcpKey.slice(0, -1)) {
      if (!(k in cur)) cur[k] = {}
      if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    const finalKey = tool.mcpKey[tool.mcpKey.length - 1]
    if (!(finalKey in cur) || typeof cur[finalKey] !== "object" || cur[finalKey] === null) cur[finalKey] = {}
    ;(cur[finalKey] as Record<string, unknown>)["you-md"] = MCP_ENTRY

    await writeJsonConfig(tool.configPath, config)
    return "installed"
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`✗ ${tool.name} — config file has corrupt JSON: ${tool.configPath}`)
      console.error(`  Fix the JSON manually or delete the file and retry.`)
    }
    return "error"
  }
}

async function uninstallFromTool(tool: ToolDef): Promise<"removed" | "not-found" | "error"> {
  try {
    if (!existsSync(tool.configPath)) return "not-found"
    if (tool.format === "toml") {
      const toml = await readTextConfig(tool.configPath)
      if (!hasCodexEntry(toml)) return "not-found"
      await writeTextConfig(tool.configPath, removeCodexEntry(toml))
      return "removed"
    }

    const config = await readJsonConfig(tool.configPath)
    if (!hasYouMdInstalled(config, tool)) return "not-found"

    let cur: Record<string, unknown> = config
    for (const k of tool.mcpKey.slice(0, -1)) {
      cur = (cur[k] ?? {}) as Record<string, unknown>
    }
    const finalKey = tool.mcpKey[tool.mcpKey.length - 1]
    delete (cur[finalKey] as Record<string, unknown>)["you-md"]
    await writeJsonConfig(tool.configPath, config)
    return "removed"
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`✗ ${tool.name} — config file has corrupt JSON: ${tool.configPath}`)
      console.error(`  Fix the JSON manually or delete the file and retry.`)
    }
    return "error"
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function installSkill(target: string | undefined, _flags: CliFlags): Promise<number> {
  const targets = target
    ? TOOLS.filter(t => t.id === target)
    : TOOLS.filter(t => isToolDetected(t))

  if (targets.length === 0 && !target) {
    console.log("No supported AI tools detected on this machine.")
    console.log("")
    console.log(`Supported tools: ${TOOLS.map(t => t.id).join(", ")}`)
    console.log("Install one, then run: you-md skill install")
    console.log("")
    console.log("Or install into a specific tool manually:")
    console.log("  you-md skill install claude-code")
    return 0
  }

  if (targets.length === 0 && target) {
    const known = TOOLS.find(t => t.id === target)
    if (!known) {
      console.error(`Unknown tool: ${target}`)
      console.error(`Supported: ${TOOLS.map(t => t.id).join(", ")}`)
      return 1
    }
    targets.push(known)
  }

  let installed = 0
  let already = 0

  for (const tool of targets) {
    const result = await installIntoTool(tool)
    if (result === "installed") {
      console.log(`✓ ${tool.name} — skill installed`)
      installed++
    } else if (result === "already") {
      console.log(`· ${tool.name} — already installed`)
      already++
    } else {
      console.error(`✗ ${tool.name} — failed to write config`)
    }
  }

  console.log("")
  if (installed > 0) {
    console.log(`you.md skill installed in ${installed} tool${installed === 1 ? "" : "s"}.`)
    console.log("Restart your AI tools to activate.")
    console.log("")
    console.log("The skill gives your AI tools access to:")
    console.log("  • Your coding preferences and style")
    console.log("  • Your project conventions")
    console.log("  • Your communication style")
    console.log("  • Anything else you define in ~/.you.md")
    console.log("")
    if (!existsSync(resolve(HOME, ".you.md")) && !existsSync(resolve(".you.md"))) {
      console.log("No you.md file found. Create one now:")
      console.log("  you-md init -i    # Interactive wizard (recommended)")
    }
  } else if (already > 0 && installed === 0) {
    console.log("All detected tools already have the skill installed.")
  }

  return 0
}

async function statusSkill(flags: CliFlags): Promise<number> {
  console.log("you.md skill status\n")

  const detected: ToolDef[] = []
  const notDetected: ToolDef[] = []

  for (const tool of TOOLS) {
    if (isToolDetected(tool)) detected.push(tool)
    else notDetected.push(tool)
  }

  if (detected.length === 0) {
    console.log("No supported AI tools detected.")
  } else {
    for (const tool of detected) {
      try {
        const active = await isInstalled(tool)
        const icon = active ? "✓" : "○"
        const label = active ? "skill active" : "not installed"
        console.log(`${icon}  ${tool.name.padEnd(18)} ${label}`)
      } catch (err) {
        const isSyntaxError = err instanceof SyntaxError
        const icon = "!"
        const label = "config JSON invalid"
        console.log(`${icon}  ${tool.name.padEnd(18)} ${label}`)
        if (isSyntaxError || flags.verbose) {
          console.log(`   ${tool.configPath}`)
          console.log("   Fix the JSON manually or delete the file, then rerun 'you-md skill status'.")
        }
      }
    }
  }

  if (notDetected.length > 0 && flags.verbose) {
    console.log("")
    console.log("Not detected:")
    for (const tool of notDetected) {
      console.log(`   ${tool.name}`)
    }
  }

  console.log("")

  const youmdPath = existsSync(resolve(HOME, ".you.md"))
    ? resolve(HOME, ".you.md")
    : existsSync(resolve(".you.md"))
      ? resolve(".you.md")
      : null

  if (youmdPath) {
    console.log(`Profile: ${youmdPath}`)
  } else {
    console.log("Profile: not found — run 'you-md init -i' to create one")
  }

  return 0
}

async function uninstallSkill(target: string | undefined, flags: CliFlags): Promise<number> {
  if (target) {
    const known = TOOLS.find(t => t.id === target)
    if (!known) {
      console.error(`Unknown tool: ${target}`)
      console.error(`Supported: ${TOOLS.map(t => t.id).join(", ")}`)
      return 1
    }
  }

  const targets = target ? TOOLS.filter(t => t.id === target) : TOOLS

  let removed = 0
  for (const tool of targets) {
    const result = await uninstallFromTool(tool)
    if (result === "removed") {
      console.log(`✓ ${tool.name} — skill removed`)
      removed++
    } else if (result === "not-found") {
      if (flags.verbose) console.log(`· ${tool.name} — not installed`)
    } else {
      console.error(`✗ ${tool.name} — error removing`)
    }
  }

  if (removed > 0) {
    console.log(`\nRemoved from ${removed} tool${removed === 1 ? "" : "s"}. Restart your AI tools to deactivate.`)
  } else {
    console.log("you.md skill was not installed in any tools.")
  }

  return 0
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function skillCommand(args: string[], flags: CliFlags): Promise<number> {
  const subcommand = args[0]
  const target = args[1]

  switch (subcommand) {
    case "install":
      return installSkill(target, flags)
    case "status":
      return statusSkill(flags)
    case "uninstall":
    case "remove":
      return uninstallSkill(target, flags)
    default:
      console.log(`you-md skill — install and manage the you.md AI skill

Usage:
  you-md skill install              Install into all detected AI tools
  you-md skill install <tool>       Install into a specific tool
  you-md skill status               Show which tools have the skill active
  you-md skill uninstall            Remove from all tools

Supported tools:
  claude-code     Claude Code
  claude-desktop  Claude Desktop (macOS/Linux)
  cursor          Cursor
  windsurf        Windsurf
  codex           Codex CLI (config.toml)
  gemini          Gemini CLI (settings.json)

Examples:
  you-md skill install              Auto-detect and install everywhere
  you-md skill install cursor       Install only into Cursor
  you-md skill status               Check current installation status
  you-md skill uninstall            Remove from all tools`)
      return 0
  }
}
