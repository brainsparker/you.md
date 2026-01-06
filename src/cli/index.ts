import { parseCliArgs, getHelpText, getVersionText } from "./args";
import { initCommand } from "./commands/init";
import { validateCommand } from "./commands/validate";
import { mergeCommand } from "./commands/merge";
import { convertCommand } from "./commands/convert";

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);

  let exitCode = 0;

  switch (args.command) {
    case "init":
      exitCode = await initCommand(args.args, args.flags);
      break;

    case "validate":
      exitCode = await validateCommand(args.args, args.flags);
      break;

    case "merge":
      exitCode = await mergeCommand(args.args, args.flags);
      break;

    case "convert":
      exitCode = await convertCommand(args.args, args.flags);
      break;

    case "version":
      console.log(getVersionText());
      break;

    case "help":
    default:
      console.log(getHelpText());
      break;
  }

  process.exit(exitCode);
}

// Run if executed directly
main();
