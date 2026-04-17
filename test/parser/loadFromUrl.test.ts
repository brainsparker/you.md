import { describe, it, expect, vi, afterEach } from "vitest";
import { createParser } from "../../src/parser/index.js";

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

  it("rejects unsupported content types before reading body", async () => {
    const parser = createParser();
    const textSpy = vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n# Me");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json" : null,
      },
      text: textSpy,
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md");

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.code === "NETWORK_ERROR")).toBe(true);
    expect(result.errors[0]?.message).toContain("Unsupported content type");
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("accepts allowed content types with charset parameters", async () => {
    const parser = createParser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? "text/markdown; charset=utf-8"
            : null,
      },
      body: null,
      text: vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n# Me"),
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md");

    expect(result.success).toBe(true);
  });
});
