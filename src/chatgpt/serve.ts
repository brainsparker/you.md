/**
 * Entry point for the remote MCP server binary (`you-md-chatgpt`).
 */
import { startHttpServerFromEnv } from "./http.js";

startHttpServerFromEnv().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start you.md ChatGPT server: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 1;
});
