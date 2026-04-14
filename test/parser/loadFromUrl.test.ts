import { describe, it, expect, vi, afterEach } from "vitest";
import { createParser } from "../../src/parser/index.js";

describe("loadFromUrl hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects local/private targets before network fetch", async () => {
    const parser = createParser();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await parser.loadFromUrl("https://127.0.0.1/profile.md");

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes("local or private network"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects redirects to local/private targets", async () => {
    const parser = createParser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://localhost/internal.md",
      headers: { get: () => null },
      text: vi.fn(async () => "---\nschema_version: \"1.1\"\n---\n# Me"),
    } as unknown as Response);

    const result = await parser.loadFromUrl("https://example.com/profile.md");

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Redirected to local or private network"))).toBe(true);
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
});
