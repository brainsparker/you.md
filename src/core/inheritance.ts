/**
 * Profile inheritance via the `extends` frontmatter field.
 *
 * A profile can declare a base it builds on:
 *
 * ```markdown
 * ---
 * schema_version: "1.1"
 * extends: "~/.you.md"
 * ---
 * ```
 *
 * The base chain is loaded root-most first and merged underneath the
 * declaring profile, so the declaring profile wins on conflicts and the base
 * fills in everything it does not mention. This module holds the pure
 * helpers (target resolution, cycle and depth checks); the parser drives the
 * actual loading so it can reuse its path and URL loaders.
 */

import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { realpathSync } from "node:fs";

import type { ParseError, ParseOptions } from "../types";
import { MAX_EXTENDS_DEPTH, REMOTE_EXTENDS_ENV_VAR } from "../utils/constants";

/** Where a profile in the chain came from */
export interface ProfileSource {
  readonly kind: "path" | "url";
  readonly value: string;
}

export type ResolveExtendsTargetResult =
  | { ok: true; source: ProfileSource }
  | { ok: false; error: ParseError };

/**
 * Turn the raw `extends` value into a loadable source, relative to the
 * profile that declared it.
 *
 * - `https://` URLs are remote sources. A relative reference inside a remote
 *   profile resolves against that profile's URL.
 * - `~` and `~/...` expand to the home directory.
 * - Relative paths resolve against the directory of the declaring file.
 * - A profile loaded from a URL may only extend other URLs; a filesystem
 *   path in a remote profile is refused.
 */
export function resolveExtendsTarget(
  spec: unknown,
  parent: ProfileSource
): ResolveExtendsTargetResult {
  if (typeof spec !== "string" || spec.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "EXTENDS_INVALID",
        message: "extends must be a non-empty string (a file path or HTTPS URL)",
        line: 1,
      },
    };
  }

  const value = spec.trim();

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!value.startsWith("https://")) {
      return {
        ok: false,
        error: {
          code: "EXTENDS_INVALID",
          message: `extends only supports HTTPS URLs, got: ${value}`,
          line: 1,
        },
      };
    }
    return { ok: true, source: { kind: "url", value } };
  }

  if (parent.kind === "url") {
    if (value.startsWith("/") || value.startsWith("~")) {
      return {
        ok: false,
        error: {
          code: "EXTENDS_INVALID",
          message: `A remote profile may only extend HTTPS URLs or URL-relative references, got: ${value}`,
          line: 1,
        },
      };
    }
    try {
      const resolved = new URL(value, parent.value);
      return { ok: true, source: { kind: "url", value: resolved.toString() } };
    } catch {
      return {
        ok: false,
        error: {
          code: "EXTENDS_INVALID",
          message: `Cannot resolve extends reference "${value}" against ${parent.value}`,
          line: 1,
        },
      };
    }
  }

  if (value === "~" || value.startsWith("~/")) {
    return {
      ok: true,
      source: { kind: "path", value: resolve(homedir(), value.slice(2)) },
    };
  }

  if (isAbsolute(value)) {
    return { ok: true, source: { kind: "path", value: resolve(value) } };
  }

  return {
    ok: true,
    source: { kind: "path", value: resolve(dirname(parent.value), value) },
  };
}

/**
 * Key used for cycle detection. Filesystem paths are canonicalized through
 * symlinks when they exist so `~/.you.md` and a symlink to it count as the
 * same profile.
 */
export function canonicalSourceKey(source: ProfileSource): string {
  if (source.kind === "url") {
    return `url:${source.value}`;
  }
  try {
    return `path:${realpathSync(source.value)}`;
  } catch {
    return `path:${resolve(source.value)}`;
  }
}

/**
 * Whether HTTPS `extends` targets are allowed for this load.
 */
export function remoteExtendsAllowed(options?: ParseOptions): boolean {
  if (options?.allowRemoteExtends !== undefined) {
    return options.allowRemoteExtends;
  }
  const raw = process.env[REMOTE_EXTENDS_ENV_VAR];
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Effective chain depth limit for this load.
 */
export function maxExtendsDepth(options?: ParseOptions): number {
  const depth = options?.maxExtendsDepth;
  if (depth === undefined || !Number.isFinite(depth) || depth < 0) {
    return MAX_EXTENDS_DEPTH;
  }
  return Math.floor(depth);
}

/**
 * Human-readable label for a source, used in error messages and CLI output.
 */
export function describeSource(source: ProfileSource): string {
  return source.value;
}
