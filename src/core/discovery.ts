import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

import type { DiscoveryOptions } from "../types/options";
import { DEFAULT_ENV_VAR, DEFAULT_FILE_NAMES } from "../utils/constants";

function isExistingFile(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Discover the path to a you.md file based on precedence rules.
 *
 * Discovery order (first found wins):
 * 1. Explicit path in options
 * 2. Environment variable (YOU_MD_PATH by default)
 * 3. Project-local (./.you.md or ./you.md)
 * 4. User-global (~/.you.md)
 * 5. XDG config (~/.config/you.md)
 * 6. Remote URL (if enabled)
 *
 * @param options - Discovery configuration
 * @returns Path to you.md file, or null if not found
 */
export async function discoverProfilePath(
  options?: DiscoveryOptions
): Promise<string | null> {
  // 1. Explicit path (highest priority)
  if (options?.path) {
    const resolvedPath = resolve(options.path);
    if (isExistingFile(resolvedPath)) {
      return resolvedPath;
    }
    // If explicit path is given but doesn't exist, return null
    // (don't fall through to discovery)
    return null;
  }

  // If discovery is disabled, stop here
  if (options?.skipDiscovery) {
    return null;
  }

  // 2. Environment variable
  const envVar = options?.envVar ?? DEFAULT_ENV_VAR;
  const envPath = process.env[envVar];
  if (envPath) {
    // Check if it's a URL
    if (envPath.startsWith("https://")) {
      if (options?.enableRemote !== false) {
        return envPath;
      }
    } else {
      const resolvedEnvPath = resolve(envPath);
      if (isExistingFile(resolvedEnvPath)) {
        return resolvedEnvPath;
      }
    }
  }

  // 3. Custom search paths (if provided)
  if (options?.searchPaths) {
    for (const searchPath of options.searchPaths) {
      const resolvedPath = resolve(searchPath);
      if (isExistingFile(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  // 4. Project-local
  const cwd = options?.cwd ?? process.cwd();
  for (const fileName of DEFAULT_FILE_NAMES) {
    const localPath = join(cwd, fileName);
    if (isExistingFile(localPath)) {
      return localPath;
    }
  }

  // 5. User home directory
  const home = homedir();
  for (const fileName of DEFAULT_FILE_NAMES) {
    const homePath = join(home, fileName);
    if (isExistingFile(homePath)) {
      return homePath;
    }
  }

  // 6. XDG config directory
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  for (const fileName of DEFAULT_FILE_NAMES) {
    const xdgPath = join(xdgConfigHome, fileName);
    if (isExistingFile(xdgPath)) {
      return xdgPath;
    }
  }

  // Also check ~/.config/you/you.md for organizational clarity
  const xdgYouDir = join(xdgConfigHome, "you");
  for (const fileName of DEFAULT_FILE_NAMES) {
    const xdgYouPath = join(xdgYouDir, fileName);
    if (isExistingFile(xdgYouPath)) {
      return xdgYouPath;
    }
  }

  // 7. Remote URL (if enabled and provided)
  if (options?.enableRemote && options?.remoteUrl) {
    // Return the URL - caller will fetch it
    return options.remoteUrl;
  }

  return null;
}

/**
 * Get the default paths that would be searched for you.md
 */
export function getDefaultSearchPaths(cwd?: string): string[] {
  const workingDir = cwd ?? process.cwd();
  const home = homedir();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");

  const paths: string[] = [];

  // Project-local
  for (const fileName of DEFAULT_FILE_NAMES) {
    paths.push(join(workingDir, fileName));
  }

  // User home
  for (const fileName of DEFAULT_FILE_NAMES) {
    paths.push(join(home, fileName));
  }

  // XDG config
  for (const fileName of DEFAULT_FILE_NAMES) {
    paths.push(join(xdgConfigHome, fileName));
  }

  // XDG config subdirectory
  for (const fileName of DEFAULT_FILE_NAMES) {
    paths.push(join(xdgConfigHome, "you", fileName));
  }

  return paths;
}
