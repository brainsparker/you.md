import { createRequire } from "node:module";

/**
 * Resolve the package version from package.json at runtime so CLI and MCP
 * output can never drift from the published version.
 *
 * The lookup walks up from the executing module because the relative depth
 * differs between dev (src/utils/) and the bundled output (dist/).
 */
export function getPackageVersion(): string {
  const require = createRequire(import.meta.url);
  for (const rel of [
    "../package.json",
    "../../package.json",
    "../../../package.json",
  ]) {
    try {
      const pkg = require(rel) as { name?: string; version?: string };
      if (pkg.version && pkg.name?.includes("you-md")) {
        return pkg.version;
      }
    } catch {
      // keep walking up
    }
  }
  return "0.0.0";
}
