import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

import type { CliFlags } from "../args.js";
import {
  distillExport,
  renderDistilledProfile,
  renderDistillReport,
  mergeIntoProfile,
  type DistillResult,
} from "../distill.js";

/**
 * Distill a ChatGPT data export into a you.md draft.
 *
 * @param args - Positional arguments (path to the export zip, folder, or conversations.json)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function distillCommand(args: string[], flags: CliFlags): Promise<number> {
  if (args.length === 0) {
    if (!flags.quiet) {
      console.error("Error: No export provided");
      console.error("Usage: you-md distill <chatgpt-export.zip | folder | conversations.json> [-o path] [--merge] [--min N] [--limit N] [--dry-run] [--json]");
      console.error("");
      console.error("Get the export from ChatGPT: Settings > Data controls > Export data.");
    }
    return 1;
  }

  const inputPath = resolve(args[0]);

  const minConversations = parsePositiveInt(flags.min, 1);
  const limit = parsePositiveInt(flags.limit, 60);
  if (minConversations === null || limit === null) {
    if (!flags.quiet) console.error("Error: --min and --limit must be whole numbers of 1 or more");
    return 1;
  }

  let result: DistillResult;
  try {
    result = distillExport(inputPath, { minConversations, limit });
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }

  if (flags.json) {
    console.log(JSON.stringify({ input: inputPath, ...result }, null, 2));
    return 0;
  }

  if (flags.dryRun) {
    console.log(renderDistillReport(result));
    return 0;
  }

  // Default destination: the user-level profile, since a ChatGPT history is
  // about the person, not one project.
  const outputPath = resolve(flags.output || resolve(homedir(), ".you.md"));

  if (flags.merge) {
    if (!existsSync(outputPath)) {
      if (!flags.quiet) {
        console.error(`Error: --merge needs an existing profile, and ${outputPath} does not exist`);
        console.error("Run without --merge to create it");
      }
      return 1;
    }
    let existing: string;
    try {
      existing = await readFile(outputPath, "utf-8");
    } catch {
      if (!flags.quiet) console.error(`Error reading file: ${outputPath}`);
      return 1;
    }
    const merged = mergeIntoProfile(existing, result);
    if (merged.added === 0) {
      if (!flags.quiet) console.log(`Nothing new: ${outputPath} already has every line the export produced`);
      return 0;
    }
    try {
      await writeFile(outputPath, merged.content, "utf-8");
    } catch {
      if (!flags.quiet) console.error(`Error writing file: ${outputPath}`);
      return 1;
    }
    if (!flags.quiet) {
      console.log(`Added ${merged.added} ${merged.added === 1 ? "line" : "lines"} to ${outputPath}`);
      printNextSteps(outputPath, result);
    }
    return 0;
  }

  if (existsSync(outputPath) && !flags.force) {
    if (!flags.quiet) {
      console.error(`Error: File already exists: ${outputPath}`);
      console.error("Use --merge to add what is missing, or --force to overwrite");
    }
    return 1;
  }

  if (result.facts.length === 0) {
    if (!flags.quiet) {
      console.log(renderDistillReport(result));
    }
    return 1;
  }

  const content = renderDistilledProfile(result);
  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf-8");
  } catch {
    if (!flags.quiet) console.error(`Error writing file: ${outputPath}`);
    return 1;
  }

  if (!flags.quiet) {
    console.log(`Wrote ${result.facts.length} ${result.facts.length === 1 ? "line" : "lines"} to ${outputPath}`);
    printNextSteps(outputPath, result);
  }
  return 0;
}

function printNextSteps(outputPath: string, result: DistillResult): void {
  const s = result.stats;
  console.log(
    `From ${s.conversations} conversations and ${s.userMessages} of your messages` +
      (s.redacted > 0 ? `, ${s.redacted} secret-shaped sentences dropped` : "")
  );
  console.log("");
  console.log("Next:");
  console.log(`  1. Open ${outputPath} and delete anything stale or private. It is a draft, not a profile yet.`);
  console.log(`  2. you-md validate ${outputPath}`);
  console.log("  3. you-md export --all   to carry it to every tool");
}

function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  return n >= 1 ? n : null;
}
