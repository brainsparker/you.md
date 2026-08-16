import { describe, it, expect } from "vitest";

import {
  BearerTokenAuthResolver,
  DevAuthResolver,
  createAuthResolverFromEnv,
  readBearerToken,
} from "../../src/chatgpt/auth.js";
import { UnauthorizedError } from "../../src/chatgpt/errors.js";

describe("readBearerToken", () => {
  it("reads a bearer token regardless of header casing", () => {
    expect(readBearerToken({ authorization: "Bearer abc123" })).toBe("abc123");
    expect(readBearerToken({ Authorization: "bearer abc123" })).toBe("abc123");
    expect(readBearerToken({ authorization: ["Bearer abc123"] })).toBe("abc123");
  });

  it("returns null for missing or non-bearer schemes", () => {
    expect(readBearerToken({})).toBeNull();
    expect(readBearerToken({ authorization: "Basic abc123" })).toBeNull();
  });
});

describe("BearerTokenAuthResolver", () => {
  const resolver = BearerTokenAuthResolver.fromEnv("tok_a:user_a, tok_b:user_b");

  it("maps a known token to its user", async () => {
    await expect(
      resolver.authenticate({ authorization: "Bearer tok_b" })
    ).resolves.toEqual({ provider: "chatgpt", providerUserId: "user_b" });
  });

  it("rejects an unknown token", async () => {
    await expect(
      resolver.authenticate({ authorization: "Bearer nope" })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a request with no credentials", async () => {
    await expect(resolver.authenticate({})).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("refuses malformed token configuration", () => {
    expect(() => BearerTokenAuthResolver.fromEnv("no-separator")).toThrow(
      /Expected "token:user_id"/
    );
    expect(() => new BearerTokenAuthResolver({})).toThrow(/at least one token/);
  });
});

describe("createAuthResolverFromEnv", () => {
  it("uses bearer tokens when configured", () => {
    const resolver = createAuthResolverFromEnv({
      YOUMD_API_TOKENS: "tok:user",
    } as NodeJS.ProcessEnv);

    expect(resolver).toBeInstanceOf(BearerTokenAuthResolver);
  });

  it("falls back to a single dev user outside production", async () => {
    const resolver = createAuthResolverFromEnv({} as NodeJS.ProcessEnv);

    expect(resolver).toBeInstanceOf(DevAuthResolver);
    await expect(resolver.authenticate({})).resolves.toEqual({
      provider: "dev",
      providerUserId: "local-dev-user",
    });
  });

  it("refuses to start unauthenticated in production", () => {
    expect(() =>
      createAuthResolverFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
    ).toThrow(/YOUMD_API_TOKENS must be set in production/);
  });
});
