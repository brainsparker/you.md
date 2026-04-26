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
