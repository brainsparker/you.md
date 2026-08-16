import { createHash, timingSafeEqual } from "node:crypto";

import { UnauthorizedError } from "./errors.js";

/**
 * The identity behind a request, before it is mapped onto an internal user id.
 */
export interface AuthenticatedIdentity {
  /** Identity provider — "chatgpt" in production, "dev" for local runs. */
  readonly provider: string;
  /** Stable id for this user within the provider. */
  readonly providerUserId: string;
}

/**
 * Resolves a request's credentials into an identity.
 *
 * V0 ships bearer tokens. OAuth slots in behind this interface without the
 * tools or storage changing: swap the resolver, keep everything else.
 */
export interface AuthResolver {
  authenticate(headers: Record<string, string | string[] | undefined>): Promise<AuthenticatedIdentity>;
}

/** Read the bearer token from an Authorization header, if present. */
export function readBearerToken(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const raw = headers["authorization"] ?? headers["Authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

/**
 * Static bearer tokens mapped to user ids.
 *
 * Configured with `YOUMD_API_TOKENS="token:user,token2:user2"`. Enough for
 * internal development and a closed test group; not an identity system.
 */
export class BearerTokenAuthResolver implements AuthResolver {
  private readonly tokens: Map<string, string>;

  constructor(tokens: Map<string, string> | Record<string, string>) {
    this.tokens =
      tokens instanceof Map ? tokens : new Map(Object.entries(tokens));

    if (this.tokens.size === 0) {
      throw new Error("BearerTokenAuthResolver requires at least one token.");
    }
  }

  static fromEnv(value: string): BearerTokenAuthResolver {
    const tokens = new Map<string, string>();

    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const separator = trimmed.lastIndexOf(":");
      if (separator <= 0 || separator === trimmed.length - 1) {
        throw new Error(
          `Invalid YOUMD_API_TOKENS entry: "${trimmed}". Expected "token:user_id".`
        );
      }

      tokens.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }

    return new BearerTokenAuthResolver(tokens);
  }

  async authenticate(
    headers: Record<string, string | string[] | undefined>
  ): Promise<AuthenticatedIdentity> {
    const token = readBearerToken(headers);
    if (!token) {
      throw new UnauthorizedError(
        "Missing bearer token. Connect the you.md app to authorize this ChatGPT account."
      );
    }

    for (const [candidate, userId] of this.tokens) {
      if (constantTimeEquals(candidate, token)) {
        return { provider: "chatgpt", providerUserId: userId };
      }
    }

    throw new UnauthorizedError("The provided token is not recognized.");
  }
}

/**
 * Treats every request as the same local user. Local development only — it is
 * refused whenever NODE_ENV is "production".
 */
export class DevAuthResolver implements AuthResolver {
  constructor(private readonly userId = "local-dev-user") {}

  async authenticate(): Promise<AuthenticatedIdentity> {
    return { provider: "dev", providerUserId: this.userId };
  }
}

/**
 * Build the resolver described by the environment.
 *
 * `YOUMD_API_TOKENS` turns on bearer auth. With it unset you get the dev
 * resolver, which refuses to start in production so an unauthenticated server
 * cannot be deployed by omission.
 */
export function createAuthResolverFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AuthResolver {
  const tokens = env.YOUMD_API_TOKENS?.trim();

  if (tokens) {
    return BearerTokenAuthResolver.fromEnv(tokens);
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "YOUMD_API_TOKENS must be set in production. Refusing to start an unauthenticated profile server."
    );
  }

  return new DevAuthResolver(env.YOUMD_DEV_USER_ID ?? "local-dev-user");
}
