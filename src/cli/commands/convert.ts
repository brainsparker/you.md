import type { CliFlags } from "../args";
import { importCommand, type ImportPaths } from "./import";

/**
 * Convert one instruction file (.cursorrules, CLAUDE.md, AGENTS.md, a Cursor
 * .mdc rule, Copilot instructions, and so on) to you.md.
 *
 * This is a thin alias of `you-md import <file>`: the same parser, the same
 * section mapping, the same current schema version. Kept so existing
 * `you-md convert` invocations keep working.
 *
 * @param args - Positional arguments (input file path)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function convertCommand(
  args: string[],
  flags: CliFlags,
  paths?: ImportPaths
): Promise<number> {
  if (args.length === 0) {
    if (!flags.quiet) {
      console.error("Error: No input file provided");
      console.error("Usage: you-md convert <input> [-o output]");
      console.error("");
      console.error("Reads any AI tool instruction file: .cursorrules, CLAUDE.md, AGENTS.md,");
      console.error("GEMINI.md, .cursor/rules/*.mdc, .windsurfrules, .clinerules, copilot-instructions.md.");
      console.error("To gather every file on this machine at once, run: you-md import");
    }
    return 1;
  }

  return importCommand(args, flags, paths);
}
