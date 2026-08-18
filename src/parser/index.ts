import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

import type {
  YouMdParser,
  YouMdProfile,
  ParseResult,
  ParseError,
  ParseWarning,
  ParseOptions,
  DiscoveryOptions,
  FetchOptions,
  MergeOptions,
  ValidationResult,
} from "../types";
import { createEmptyProfile } from "../types/profile";
import { extractFrontmatter } from "./frontmatter";
import { parseYaml } from "./yaml";
import { extractSections, flattenSections } from "./markdown";
import { discoverProfilePath } from "../core/discovery";
import { mergeProfiles } from "../core/merger";
import { validateProfile } from "../core/validator";
import {
  MAX_FILE_SIZE,
  DEFAULT_FETCH_TIMEOUT,
  MAX_FETCH_TIMEOUT,
  CURRENT_SCHEMA_VERSION,
} from "../utils/constants";

/**
 * True when the IPv4 address (as octets) falls in a loopback, private,
 * link-local, CGNAT, or unspecified range.
 */
function ipv4IsPrivate(parts: number[]): boolean {
  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 unspecified
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) // 192.168.0.0/16 private
  );
}

/**
 * SSRF guard for remote profile loading: true when a URL hostname points at
 * a local or private network location that a profile fetch must never reach
 * (loopback, RFC 1918/4193 ranges, link-local including cloud metadata
 * endpoints, and mDNS/internal name suffixes).
 *
 * Expects a WHATWG `URL.hostname` value, which is already lowercased and
 * canonicalized (IPv6 arrives bracketed, IPv4-mapped IPv6 in hex form).
 */
export function isDisallowedRemoteHostname(rawHostname: string): boolean {
  let hostname = rawHostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (
    hostname === "localhost" ||
    hostname === "localhost.localdomain" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const ipType = isIP(hostname);

  if (ipType === 4) {
    return ipv4IsPrivate(hostname.split(".").map(Number));
  }

  if (ipType === 6) {
    if (hostname === "::" || hostname === "::1") {
      return true; // unspecified / loopback
    }
    if (hostname.startsWith("fc") || hostname.startsWith("fd")) {
      return true; // fc00::/7 unique-local
    }
    if (/^fe[89ab]/.test(hostname)) {
      return true; // fe80::/10 link-local
    }
    // Prefixes that embed an IPv4 address in the low 32 bits, all of which
    // reach that IPv4 target: ::ffff:x/96 (mapped), ::x/96 (IPv4-compatible,
    // deprecated but still routed to loopback by common stacks), and
    // 64:ff9b::x/96 (NAT64). Check the embedded IPv4 against the v4 ranges.
    // Order matters: the longer prefixes must be tested before bare "::".
    const embeddedPrefix = ["::ffff:", "64:ff9b::", "::"].find((prefix) =>
      hostname.startsWith(prefix)
    );
    if (embeddedPrefix !== undefined) {
      const rest = hostname.slice(embeddedPrefix.length);
      if (isIP(rest) === 4) {
        return ipv4IsPrivate(rest.split(".").map(Number));
      }
      const groups = rest.split(":");
      if (groups.length === 2) {
        const hi = Number.parseInt(groups[0], 16);
        const lo = Number.parseInt(groups[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          return ipv4IsPrivate([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
        }
      }
      return true; // unparseable embedded form: refuse rather than guess
    }
  }

  return false;
}

/**
 * Default parser implementation
 */
export class YouMdParserImpl implements YouMdParser {
  private readonly maxFileSize: number;

  constructor(options?: { maxFileSize?: number }) {
    this.maxFileSize = options?.maxFileSize ?? MAX_FILE_SIZE;
  }

  parse(content: string, options?: ParseOptions): ParseResult {
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    // Check size limit
    const size = new TextEncoder().encode(content).length;
    const maxSize = options?.maxFileSize ?? this.maxFileSize;

    if (size > maxSize) {
      errors.push({
        code: "FILE_TOO_LARGE",
        message: `Content size ${size} bytes exceeds maximum ${maxSize} bytes`,
      });
      return {
        profile: createEmptyProfile(),
        success: false,
        errors,
        warnings,
      };
    }

    // Capture start time for timeout enforcement
    const maxParseTime = options?.maxParseTime;
    const parseStart = maxParseTime !== undefined ? Date.now() : 0;

    // Extract frontmatter
    const frontmatterResult = extractFrontmatter(content);

    if (!frontmatterResult.hasFrontmatter) {
      warnings.push({
        code: "NO_FRONTMATTER",
        message: "No YAML frontmatter found",
        line: 1,
      });
    }

    // Check timeout after frontmatter extraction
    if (maxParseTime !== undefined && Date.now() - parseStart >= maxParseTime) {
      errors.push({
        code: "PARSE_TIMEOUT",
        message: `Parse exceeded timeout of ${maxParseTime}ms`,
      });
      return { profile: createEmptyProfile(), success: false, errors, warnings };
    }

    // Parse YAML frontmatter
    let metadata: Record<string, unknown> = {};
    let hasSchemaVersion = false;

    if (frontmatterResult.frontmatter) {
      const yamlResult = parseYaml(frontmatterResult.frontmatter);

      if (yamlResult.errors.length > 0) {
        for (const err of yamlResult.errors) {
          errors.push({
            code: "INVALID_YAML",
            message: err.message,
            line: err.line,
            column: err.column,
          });
        }
      }

      if (yamlResult.data) {
        metadata = { ...yamlResult.data };
        hasSchemaVersion = !!(
          yamlResult.data.schema_version || yamlResult.data.schemaVersion
        );
      }
    }

    // Check timeout after YAML parsing
    if (maxParseTime !== undefined && Date.now() - parseStart >= maxParseTime) {
      errors.push({
        code: "PARSE_TIMEOUT",
        message: `Parse exceeded timeout of ${maxParseTime}ms`,
      });
      return { profile: createEmptyProfile(), success: false, errors, warnings };
    }

    // Check for schema version
    if (!hasSchemaVersion) {
      errors.push({
        code: "MISSING_SCHEMA_VERSION",
        message: "Missing required schema_version in frontmatter",
        line: 1,
      });
    }

    // Normalize schema version field
    const schemaVersion =
      (metadata.schema_version as string) ||
      (metadata.schemaVersion as string) ||
      CURRENT_SCHEMA_VERSION;

    // Parse markdown sections
    const sectionResult = extractSections(
      frontmatterResult.content,
      frontmatterResult.contentStartLine
    );

    for (const warning of sectionResult.warnings) {
      warnings.push({
        code: "EMPTY_SECTION",
        message: warning.message,
        line: warning.line,
      });
    }

    // Build profile
    const sections = flattenSections(sectionResult.sections);

    const profile: YouMdProfile = {
      schemaVersion,
      metadata: {
        schemaVersion,
        created: metadata.created as string | undefined,
        lastUpdated:
          (metadata.last_updated as string) ||
          (metadata.lastUpdated as string) ||
          undefined,
        privacyLevel: metadata.privacy_level as
          | "public"
          | "private"
          | "authenticated"
          | undefined,
        profileId: metadata.profile_id as string | undefined,
        extends: metadata.extends as string | undefined,
        ttl: metadata.ttl as number | undefined,
        author: metadata.author as string | undefined,
        tags: metadata.tags as string[] | undefined,
        ...metadata,
      },
      sections,
      rawContent: content,
    };

    return {
      profile,
      success: errors.length === 0,
      errors,
      warnings,
    };
  }

  async loadFromPath(
    path: string,
    options?: ParseOptions
  ): Promise<ParseResult> {
    const resolvedPath = resolve(path);

    // Check if file exists
    if (!existsSync(resolvedPath)) {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "FILE_NOT_FOUND",
            message: `File not found: ${resolvedPath}`,
          },
        ],
        warnings: [],
      };
    }

    // Check file size before reading
    try {
      const stats = await stat(resolvedPath);
      const maxSize = options?.maxFileSize ?? this.maxFileSize;

      if (!stats.isFile()) {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "PERMISSION_DENIED",
              message: `Path is not a regular file: ${resolvedPath}`,
            },
          ],
          warnings: [],
        };
      }

      if (stats.size > maxSize) {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "FILE_TOO_LARGE",
              message: `File size ${stats.size} bytes exceeds maximum ${maxSize} bytes`,
            },
          ],
          warnings: [],
        };
      }
    } catch (err) {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "PERMISSION_DENIED",
            message: `Cannot access file: ${resolvedPath}`,
          },
        ],
        warnings: [],
      };
    }

    // Read and parse
    try {
      const content = await readFile(resolvedPath, "utf-8");
      const result = this.parse(content, options);

      // Add source path to profile
      const profileWithPath: YouMdProfile = {
        ...result.profile,
        sourcePath: resolvedPath,
      };

      return {
        ...result,
        profile: profileWithPath,
      };
    } catch (err) {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "PERMISSION_DENIED",
            message: `Cannot read file: ${resolvedPath}`,
          },
        ],
        warnings: [],
      };
    }
  }

  async loadFromUrl(
    url: string,
    fetchOptions?: FetchOptions,
    parseOptions?: ParseOptions
  ): Promise<ParseResult> {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "NETWORK_ERROR",
            message: `Invalid URL: ${url}`,
          },
        ],
        warnings: [],
      };
    }

    // Enforce HTTPS
    if (parsedUrl.protocol !== "https:") {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "NETWORK_ERROR",
            message: "Only HTTPS URLs are supported",
          },
        ],
        warnings: [],
      };
    }

    if (parsedUrl.username || parsedUrl.password) {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "NETWORK_ERROR",
            message: "Credentials in URL are not supported",
          },
        ],
        warnings: [],
      };
    }

    if (isDisallowedRemoteHostname(parsedUrl.hostname)) {
      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "NETWORK_ERROR",
            message:
              "Refusing to fetch profiles from local or private network addresses",
          },
        ],
        warnings: [],
      };
    }

    const timeout = this.resolveFetchTimeout(fetchOptions?.timeout);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        Accept: "text/markdown, text/plain, */*",
        ...fetchOptions?.headers,
      };

      if (fetchOptions?.authToken) {
        headers.Authorization = `Bearer ${fetchOptions.authToken}`;
      }

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "error",
      });

      if (!response.ok) {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "NETWORK_ERROR",
              message: `HTTP ${response.status}: ${response.statusText}`,
            },
          ],
          warnings: [],
        };
      }

      const maxSize = parseOptions?.maxFileSize ?? this.maxFileSize;
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > maxSize) {
          return {
            profile: createEmptyProfile(),
            success: false,
            errors: [
              {
                code: "FILE_TOO_LARGE",
                message: `Response size ${contentLength} bytes exceeds maximum ${maxSize} bytes`,
              },
            ],
            warnings: [],
          };
        }
      }

      const content = await this.readResponseTextWithLimit(response, maxSize);
      const result = this.parse(content, parseOptions);

      // Add source URL to profile
      const profileWithUrl: YouMdProfile = {
        ...result.profile,
        sourceUrl: url,
      };

      return {
        ...result,
        profile: profileWithUrl,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "TIMEOUT",
              message: `Request timed out after ${timeout}ms`,
            },
          ],
          warnings: [],
        };
      }

      if (
        err instanceof Error &&
        err.message.includes("exceeds maximum")
      ) {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "FILE_TOO_LARGE",
              message: err.message,
            },
          ],
          warnings: [],
        };
      }

      if (err instanceof Error && /redirect/i.test(err.message)) {
        return {
          profile: createEmptyProfile(),
          success: false,
          errors: [
            {
              code: "NETWORK_ERROR",
              message: "Redirects are not allowed for remote profile loading",
            },
          ],
          warnings: [],
        };
      }

      return {
        profile: createEmptyProfile(),
        success: false,
        errors: [
          {
            code: "NETWORK_ERROR",
            message: err instanceof Error ? err.message : "Unknown network error",
          },
        ],
        warnings: [],
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveFetchTimeout(timeoutMs?: number): number {
    if (timeoutMs === undefined) {
      return DEFAULT_FETCH_TIMEOUT;
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return DEFAULT_FETCH_TIMEOUT;
    }

    if (timeoutMs > MAX_FETCH_TIMEOUT) {
      return MAX_FETCH_TIMEOUT;
    }

    return Math.floor(timeoutMs);
  }

  private async readResponseTextWithLimit(
    response: Response,
    maxSize: number
  ): Promise<string> {
    if (!response.body) {
      const content = await response.text();
      const size = new TextEncoder().encode(content).length;
      if (size > maxSize) {
        throw new Error(
          `Response size ${size} bytes exceeds maximum ${maxSize} bytes`
        );
      }
      return content;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxSize) {
          await reader.cancel();
          throw new Error(
            `Response size ${totalBytes} bytes exceeds maximum ${maxSize} bytes`
          );
        }
        chunks.push(value);
      }
    }

    const contentBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      contentBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(contentBytes);
  }

  async discover(options?: DiscoveryOptions): Promise<ParseResult | null> {
    const path = await discoverProfilePath(options);

    if (!path) {
      return null;
    }

    // Check if it's a URL
    if (path.startsWith("https://")) {
      return this.loadFromUrl(path);
    }

    return this.loadFromPath(path);
  }

  merge(profiles: YouMdProfile[], options?: MergeOptions): YouMdProfile {
    return mergeProfiles(profiles, options);
  }

  validate(profile: YouMdProfile): ValidationResult {
    return validateProfile(profile);
  }
}

/**
 * Create a new parser instance
 */
export function createParser(options?: { maxFileSize?: number }): YouMdParser {
  return new YouMdParserImpl(options);
}

// Re-export components
export { extractFrontmatter } from "./frontmatter";
export { parseYaml } from "./yaml";
export { extractSections, findSection, flattenSections } from "./markdown";
