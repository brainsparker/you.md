import { parseArgs } from "node:util";

/**
 * CLI command types
 */
export type Command =
  | "init"
  | "validate"
  | "merge"
  | "convert"
  | "help"
  | "version";

/**
 * Parsed CLI arguments
 */
export interface CliArgs {
  /** The command to run */
  command: Command;

  /** Positional arguments for the command */
  args: string[];

  /** Flags/options */
  flags: CliFlags;
}

/**
 * CLI flags
 */
export interface CliFlags {
  /** Show help */
  help?: boolean;

  /** Show version */
  version?: boolean;

  /** Output file path */
  output?: string;

  /** Output format */
  format?: string;

  /** Suppress output */
  quiet?: boolean;

  /** Verbose output */
  verbose?: boolean;

  /** Force overwrite */
  force?: boolean;

  /** Use JSON output */
  json?: boolean;
}

/**
 * Parse command line arguments
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // Remove node and script path
  const args = argv.slice(2);

  // Define options
  const options = {
    help: { type: "boolean" as const, short: "h" },
    version: { type: "boolean" as const, short: "v" },
    output: { type: "string" as const, short: "o" },
    format: { type: "string" as const, short: "f" },
    quiet: { type: "boolean" as const, short: "q" },
    verbose: { type: "boolean" as const },
    force: { type: "boolean" as const },
    json: { type: "boolean" as const },
  };

  try {
    const { values, positionals } = parseArgs({
      args,
      options,
      allowPositionals: true,
    });

    // Extract command from first positional or flags
    let command: Command = "help";

    if (values.help) {
      command = "help";
    } else if (values.version) {
      command = "version";
    } else if (positionals.length > 0) {
      const cmd = positionals[0].toLowerCase();
      if (isValidCommand(cmd)) {
        command = cmd;
      }
    }

    return {
      command,
      args: positionals.slice(1),
      flags: {
        help: values.help,
        version: values.version,
        output: values.output,
        format: values.format,
        quiet: values.quiet,
        verbose: values.verbose,
        force: values.force,
        json: values.json,
      },
    };
  } catch (error) {
    // On parse error, default to help
    return {
      command: "help",
      args: [],
      flags: {},
    };
  }
}

/**
 * Check if a string is a valid command
 */
function isValidCommand(cmd: string): cmd is Command {
  return ["init", "validate", "merge", "convert", "help", "version"].includes(
    cmd
  );
}

/**
 * Get help text
 */
export function getHelpText(): string {
  return `
you-md - Parser and CLI for you.md personal AI context files

Usage: you-md <command> [options] [arguments]

Commands:
  init [path]              Create a new you.md file (default: ./.you.md)
  validate <path>          Validate a you.md file
  merge <paths...>         Merge multiple you.md files
  convert <input>          Convert from other formats (.cursorrules, etc.)
  help                     Show this help message
  version                  Show version number

Options:
  -h, --help               Show help
  -v, --version            Show version
  -o, --output <path>      Output file path
  -f, --format <format>    Output format (markdown, json)
  -q, --quiet              Suppress output
  --verbose                Verbose output
  --force                  Force overwrite existing files
  --json                   Output as JSON

Examples:
  you-md init                     Create .you.md in current directory
  you-md init ~/.you.md           Create global you.md
  you-md validate ./you.md        Validate a file
  you-md merge ~/.you.md ./.you.md  Merge user and project profiles
  you-md convert .cursorrules     Convert .cursorrules to you.md

Documentation: https://github.com/briansparker/You
`.trim();
}

/**
 * Get version text
 */
export function getVersionText(): string {
  return "you-md version 0.1.0";
}
