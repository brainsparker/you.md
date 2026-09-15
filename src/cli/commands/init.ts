import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import prompts from "prompts";

import type { CliFlags } from "../args.js";
import {
  getDefaultTemplate,
  getMinimalTemplate,
  getPersonalizationTemplate,
  getIdentityTemplate,
  getDeveloperTemplate,
} from "../templates/default.js";
import { runWizard, generateFromAnswers } from "../wizard.js";
import {
  gatherSignals,
  buildProfileFromSignals,
  formatScanResults,
} from "../infer.js";

/**
 * Initialize a new you.md file
 *
 * @param args - Positional arguments (optional path)
 * @param flags - CLI flags
 * @returns Exit code (0 = success, 1 = error)
 */
export async function initCommand(
  args: string[],
  flags: CliFlags
): Promise<number> {
  // --from-me mode
  if (flags.fromMe) {
    return initFromMe(args, flags);
  }

  // Determine output path
  const outputPath = resolve(args[0] || ".you.md");

  // Check if file exists
  if (existsSync(outputPath) && !flags.force) {
    if (!flags.quiet) {
      console.error(`Error: File already exists: ${outputPath}`);
      console.error("Use --force to overwrite");
    }
    return 1;
  }

  let template: string;

  // Interactive wizard mode
  if (flags.interactive) {
    const answers = await runWizard();
    if (!answers) {
      // User cancelled
      return 1;
    }
    template = generateFromAnswers(answers);
  } else {
    // Get template content based on format
    switch (flags.format) {
      case "identity":
        template = getIdentityTemplate();
        break;
      case "developer":
        template = getDeveloperTemplate();
        break;
      case "minimal":
        template = getMinimalTemplate();
        break;
      case "personalization":
      case "signals":
        template = getPersonalizationTemplate();
        break;
      default:
        // Default is identity template (v1.1)
        template = getDefaultTemplate();
    }
  }

  try {
    // Ensure directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Write file
    await writeFile(outputPath, template, "utf-8");

    if (!flags.quiet) {
      console.log(`\n✓ Created: ${outputPath}`);
      if (!flags.interactive) {
        console.log("");
        console.log("Next steps:");
        console.log("  1. Edit the file to add your preferences");
        console.log("  2. Run 'you-md validate " + outputPath + "' to check");
      }
    }

    return 0;
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error writing file: ${outputPath}`);
      if (flags.verbose && error instanceof Error) {
        console.error(error.message);
      }
    }
    return 1;
  }
}

/**
 * --from-me mode: scan environment, build inferred profile, prompt to save
 */
async function initFromMe(
  args: string[],
  flags: CliFlags
): Promise<number> {
  const outputPath = resolve(args[0] || resolve(homedir(), ".you.md"));

  // Check if file exists
  if (existsSync(outputPath) && !flags.force) {
    if (!flags.quiet) {
      console.error(`Error: File already exists: ${outputPath}`);
      console.error("Use --force to overwrite");
    }
    return 1;
  }

  console.log("\nScanning your environment...\n");

  const signals = await gatherSignals();
  const scanOutput = formatScanResults(signals);
  console.log(scanOutput);

  const profile = buildProfileFromSignals(signals);

  console.log("\nHere's your inferred profile:");
  console.log("─".repeat(50));
  console.log(profile);
  console.log("─".repeat(50));

  // Prompt to save
  if (flags.quiet) {
    // Non-interactive: just print to stdout and don't save
    return 0;
  }

  const response = await prompts({
    type: "select",
    name: "action",
    message: `Save to ${outputPath}?`,
    choices: [
      { title: "Yes", value: "yes" },
      { title: "No", value: "no" },
      { title: "Edit", value: "edit" },
    ],
    initial: 0,
  });

  if (!response.action || response.action === "no") {
    console.log("Profile not saved.");
    return 1;
  }

  if (response.action === "edit") {
    // Try to open in $EDITOR
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (editor) {
      // Write to a temp file, open editor, read back
      const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
      const { spawnSync } = await import("node:child_process");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tmpFile = join(tmpdir(), `you-md-${Date.now()}.md`);
      writeFileSync(tmpFile, profile, "utf-8");
      spawnSync(editor, [tmpFile], { stdio: "inherit" });

      const edited = readFileSync(tmpFile, "utf-8");
      unlinkSync(tmpFile);

      try {
        const dir = dirname(outputPath);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(outputPath, edited, "utf-8");
        console.log(`\n✓ Saved edited profile: ${outputPath}`);
      } catch (err) {
        console.error(`Error writing file: ${outputPath}`);
        return 1;
      }
    } else {
      console.log(`\nNo $EDITOR set. Save the profile at:\n  ${outputPath}`);
      try {
        const dir = dirname(outputPath);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(outputPath, profile, "utf-8");
        console.log(`Profile saved. Edit manually and run:\n  you-md validate ${outputPath}`);
      } catch (err) {
        console.error(`Error writing file: ${outputPath}`);
        return 1;
      }
    }
    return 0;
  }

  // Yes — save
  try {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(outputPath, profile, "utf-8");
    console.log(`\n✓ Saved: ${outputPath}`);
    console.log("Edit anytime and re-run: you-md validate " + outputPath);
    return 0;
  } catch (error) {
    if (!flags.quiet) {
      console.error(`Error writing file: ${outputPath}`);
      if (flags.verbose && error instanceof Error) {
        console.error(error.message);
      }
    }
    return 1;
  }
}