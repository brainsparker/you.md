import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

describe("skill status hardening", () => {
  const originalHome = process.env.HOME;
  const fakeHome = join(tmpdir(), `you-md-skill-status-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
    mkdirSync(join(fakeHome, ".cursor"), { recursive: true });
    // Corrupt config should not crash status command
    writeFileSync(join(fakeHome, ".cursor", "mcp.json"), "{ broken json", "utf-8");
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(fakeHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("does not throw when a detected tool has invalid JSON config", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { skillCommand } = await import("../../src/cli/commands/skill");

    await expect(skillCommand(["status"], {})).resolves.toBe(0);

    const output = logSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n");
    expect(output).toContain("config JSON invalid");
    expect(output).toContain("Cursor");
  });
});
