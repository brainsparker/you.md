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
  /** The JSON key path where mcpServers lives, e.g. ["mcpServers"] */
  mcpKey: string[]
  /** True if the config file must exist for the tool to be "detected" */
  requiresExisting: boolean
  /** Paths to check to confirm the tool is installed */
  installHints: string[]
}

const HOME = homedir()
const IS_MAC = platform() === "darwin"

const TOOLS: ToolDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    configPath: resolve(HOME, ".claude", "claude_desktop_config.json"),
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
    mcpKey: ["mcpServers"],
    requiresExisting: false,
    installHints: IS_MAC
      ? ["/Applications/Windsurf.app", resolve(HOME, ".codeium")]
      : [resolve(HOME, ".codeium"), "/usr/local/bin/windsurf"],
  },
]

// The MCP server entry to inject
const MCP_ENTRY = {
  command: "npx",
  args: ["-y", "-p", "you-md", "you-md-mcp"],
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

async function installIntoTool(tool: ToolDef): Promise<"installed" | "already" | "error"> {
  try {
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
    console.log("Supported tools: claude-code, claude-desktop, cursor, windsurf")
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
        const config = await readJsonConfig(tool.configPath)
        const active = hasYouMdInstalled(config, tool)
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

Examples:
  you-md skill install              Auto-detect and install everywhere
  you-md skill install cursor       Install only into Cursor
  you-md skill status               Check current installation status
  you-md skill uninstall            Remove from all tools`)
      return 0
  }
}
