import { describe, it, expect, vi, afterEach } from "vitest";
import { createParser } from "../../src/parser/index.js";
import {
  DEFAULT_FETCH_TIMEOUT,
  MAX_FETCH_TIMEOUT,
} from "../../src/utils/constants.js";

describe("loadFromUrl hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects oversized responses using content-length before body read", async () => {
    const parser = createParser();
    const textSpy = vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n# Me");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? "999999" : null) },
      text: textSpy,
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md", undefined, {
      maxFileSize: 1024,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "FILE_TOO_LARGE")).toBe(true);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("returns TIMEOUT when fetch is aborted", async () => {
    const parser = createParser();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const result = await parser.loadFromUrl("https://example.com/profile.md", { timeout: 5 });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "TIMEOUT")).toBe(true);
  });

  it("disables redirects when fetching remote profiles", async () => {
    const parser = createParser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: null,
      text: vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n# Me"),
    } as unknown as Response);

    await parser.loadFromUrl("https://example.com/profile.md");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/profile.md",
      expect.objectContaining({ redirect: "error" })
    );
  });

  it("returns NETWORK_ERROR when upstream responds with a redirect", async () => {
    const parser = createParser();

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("redirect mode is set to error")
    );

    const result = await parser.loadFromUrl("https://example.com/profile.md");

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NETWORK_ERROR",
          message: "Redirects are not allowed for remote profile loading",
        }),
      ])
    );
  });

  it("rejects oversized streamed responses when content-length is missing", async () => {
    const parser = createParser();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("a".repeat(600)));
        controller.enqueue(encoder.encode("b".repeat(600)));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: stream,
      text: vi.fn(async () => ""),
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md", undefined, {
      maxFileSize: 1024,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "FILE_TOO_LARGE")).toBe(true);
  });

  it("rejects URLs containing embedded credentials", async () => {
    const parser = createParser();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await parser.loadFromUrl("https://user:secret@example.com/profile.md");

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "NETWORK_ERROR")).toBe(true);
    expect(result.errors[0]?.message).toContain("Credentials in URL are not supported");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to default timeout when fetch timeout is invalid", async () => {
    const parser = createParser();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: null,
      text: vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n\n# Me\n"),
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md", {
      timeout: -1,
    });

    expect(result.success).toBe(true);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(DEFAULT_FETCH_TIMEOUT);
  });

  it("caps fetch timeout when timeout is excessively large", async () => {
    const parser = createParser();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: null,
      text: vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n\n# Me\n"),
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md", {
      timeout: Number.MAX_SAFE_INTEGER,
    });

    expect(result.success).toBe(true);
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(MAX_FETCH_TIMEOUT);
  });
});

describe("loadFromUrl SSRF guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const blockedUrls = [
    "https://127.0.0.1/profile.md",
    "https://127.8.9.10/profile.md",
    "https://localhost/profile.md",
    "https://sub.localhost/profile.md",
    "https://localhost.localdomain/profile.md",
    "https://10.0.0.5/profile.md",
    "https://100.64.1.1/profile.md",
    "https://172.16.0.1/profile.md",
    "https://172.31.255.255/profile.md",
    "https://192.168.1.1/profile.md",
    "https://169.254.169.254/profile.md",
    "https://0.0.0.0/profile.md",
    "https://[::1]/profile.md",
    "https://[::]/profile.md",
    "https://[fc00::1]/profile.md",
    "https://[fd12:3456::1]/profile.md",
    "https://[fe80::1]/profile.md",
    "https://[::ffff:127.0.0.1]/profile.md",
    "https://[::ffff:192.168.1.1]/profile.md",
    "https://[::127.0.0.1]/profile.md",
    "https://[::10.0.0.5]/profile.md",
    "https://[64:ff9b::127.0.0.1]/profile.md",
    "https://printer.local/profile.md",
    "https://db.prod.internal/profile.md",
  ];

  it.each(blockedUrls)("rejects %s before any network fetch", async (url) => {
    const parser = createParser();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await parser.loadFromUrl(url);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "NETWORK_ERROR")).toBe(true);
    expect(
      result.errors.some((e) =>
        e.message.includes("local or private network")
      )
    ).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const allowedUrls = [
    "https://example.com/profile.md",
    "https://raw.githubusercontent.com/user/repo/main/you.md",
    "https://11.22.33.44/profile.md",
    "https://172.15.0.1/profile.md",
    "https://172.32.0.1/profile.md",
    "https://100.63.0.1/profile.md",
    "https://100.128.0.1/profile.md",
    "https://mylocal.example.com/profile.md",
    "https://[2606:4700::1111]/profile.md",
    "https://[64:ff9b::93.184.216.34]/profile.md",
  ];

  it.each(allowedUrls)("allows %s through to fetch", async (url) => {
    const parser = createParser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: null,
      text: vi.fn(async () => '---\nschema_version: "1.1"\n---\n\n# Me\n'),
    } as unknown as Response);

    const result = await parser.loadFromUrl(url);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("rejects IPv6 addresses that canonicalize to loopback", async () => {
    const parser = createParser();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // WHATWG URL canonicalizes the expanded form to ::1
    const result = await parser.loadFromUrl(
      "https://[0:0:0:0:0:0:0:1]/profile.md"
    );

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
