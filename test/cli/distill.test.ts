import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import {
  classifySentence,
  distillExport,
  distillMessages,
  extractUserMessages,
  looksSecret,
  mergeIntoProfile,
  normalizeFact,
  openChatGptExport,
  presentFact,
  readZipEntries,
  renderDistilledProfile,
  renderDistillReport,
  splitSentences,
  type UserMessage,
} from "../../src/cli/distill";
import { distillCommand } from "../../src/cli/commands/distill";
import { createParser } from "../../src/parser";
import { validateProfile } from "../../src/core/validator";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

type Turn = [role: "user" | "assistant" | "system" | "tool", text: string];

interface ConvOptions {
  t0?: number;
  hidden?: number[];
  abandoned?: string;
  omitCurrentNode?: boolean;
}

/** Build one export conversation as a parent/children tree */
function conversation(id: string, title: string, turns: Turn[], opts: ConvOptions = {}) {
  const t0 = opts.t0 ?? 1_740_000_000;
  const root = `root-${id}`;
  const mapping: Record<string, any> = {
    [root]: { id: root, parent: null, children: [], message: null },
  };
  let prev = root;
  let last: string | undefined;
  turns.forEach(([role, text], i) => {
    const nid = `${id}-${i}`;
    const message: any = {
      id: nid,
      author: { role },
      create_time: t0 + i * 60,
      content: { content_type: "text", parts: [text] },
      metadata: {},
    };
    if (opts.hidden?.includes(i)) message.metadata.is_visually_hidden_from_conversation = true;
    mapping[nid] = { id: nid, parent: prev, children: [], message };
    mapping[prev].children.push(nid);
    prev = nid;
    last = nid;
  });
  if (opts.abandoned) {
    // A sibling branch off the root that the user edited away from.
    const nid = `${id}-abandoned`;
    mapping[nid] = {
      id: nid,
      parent: root,
      children: [],
      message: {
        id: nid,
        author: { role: "user" },
        create_time: t0,
        content: { content_type: "text", parts: [opts.abandoned] },
        metadata: {},
      },
    };
    mapping[root].children.unshift(nid);
  }
  return {
    id,
    conversation_id: id,
    title,
    create_time: t0,
    update_time: t0 + 600,
    mapping,
    current_node: opts.omitCurrentNode ? undefined : last,
  };
}

const SAMPLE = [
  conversation(
    "c1",
    "Refactor help",
    [
      ["user", "I'm a staff product manager at a developer platform company. Can you help me rewrite this paragraph?"],
      ["assistant", "Sure, here is a rewrite. I am an assistant and I love emojis."],
      ["user", "Keep answers concise, I don't need long explanations. Also, never use emojis."],
      ["assistant", "Got it."],
    ],
    { t0: 1_700_000_000, abandoned: "I'm a professional juggler and I live in Antarctica." }
  ),
  conversation(
    "c2",
    "TypeScript question",
    [
      ["user", "I prefer TypeScript in strict mode. Why does this error happen?\n```ts\nconst x: number = 'a';\n```"],
      ["assistant", "Because..."],
      ["user", "I live at 10.0.0.1 and my email is someone@example.com."],
      ["assistant", "I cannot."],
      ["user", "From now on, answer in bullet points."],
    ],
    { t0: 1_720_000_000 }
  ),
  conversation(
    "c3",
    "Travel plans",
    [
      ["user", "I live in Cleveland, Ohio. Plan me a weekend in Chicago?"],
      ["assistant", "..."],
      ["user", "I love hiking and craft beer. Can you add a brewery?"],
      ["assistant", "..."],
      ["user", "Never use emojis."],
    ],
    { t0: 1_730_000_000 }
  ),
  conversation(
    "c4",
    "Side project",
    [
      ["user", "I'm building a clipboard manager for macOS in Swift. Explain NSPasteboard."],
      ["assistant", "..."],
      ["user", "Write a haiku about rain."],
      ["user", "I'm a staff product manager at a developer platform company, so assume I know the basics."],
      ["user", "I am a secret agent and this line is hidden."],
    ],
    { t0: 1_735_000_000, hidden: [4] }
  ),
  conversation("c5", "Small talk", [
    ["user", "hi"],
    ["assistant", "hello"],
  ]),
];

/** Minimal zip writer (deflate, no ZIP64), matching what the reader supports */
function buildZip(files: Array<{ name: string; data: Buffer | string }>): Buffer {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf-8");
    const name = Buffer.from(f.name, "utf-8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDir, eocd]);
}

// ---------------------------------------------------------------------------
// Temp dirs
// ---------------------------------------------------------------------------

const tempDir = join(tmpdir(), `you-md-distill-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeExportFolder(dir: string, convs: unknown[] = SAMPLE): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "conversations.json"), JSON.stringify(convs));
  writeFileSync(join(dir, "user.json"), JSON.stringify({ id: "u", email: "someone@example.com" }));
  writeFileSync(join(dir, "chat.html"), "<html></html>");
  return dir;
}

// ---------------------------------------------------------------------------
// Walking the tree
// ---------------------------------------------------------------------------

describe("extractUserMessages", () => {
  it("returns only the user's messages on the active branch, in order", () => {
    const msgs = extractUserMessages(SAMPLE[0] as any, 0);
    expect(msgs.map((m) => m.text)).toEqual([
      "I'm a staff product manager at a developer platform company. Can you help me rewrite this paragraph?",
      "Keep answers concise, I don't need long explanations. Also, never use emojis.",
    ]);
    expect(msgs[0].conversationId).toBe("c1");
    expect(msgs[0].conversationTitle).toBe("Refactor help");
    expect(msgs[0].time).toBe(1_700_000_000);
  });

  it("ignores abandoned branches the user edited away from", () => {
    const msgs = extractUserMessages(SAMPLE[0] as any, 0);
    expect(msgs.some((m) => m.text.includes("juggler"))).toBe(false);
  });

  it("skips messages ChatGPT hid from the conversation", () => {
    const msgs = extractUserMessages(SAMPLE[3] as any, 3);
    expect(msgs.some((m) => m.text.includes("secret agent"))).toBe(false);
    expect(msgs).toHaveLength(3);
  });

  it("falls back to walking from the root when current_node is missing", () => {
    const conv = conversation(
      "x",
      "No pointer",
      [
        ["user", "I work as a nurse."],
        ["assistant", "ok"],
        ["user", "I prefer short answers."],
      ],
      { omitCurrentNode: true }
    );
    const msgs = extractUserMessages(conv as any, 0);
    expect(msgs.map((m) => m.text)).toEqual(["I work as a nurse.", "I prefer short answers."]);
  });

  it("joins string parts and drops non-text parts of multimodal messages", () => {
    const conv = conversation("m", "Images", [["user", "placeholder"]]);
    conv.mapping["m-0"].message.content = {
      content_type: "multimodal_text",
      parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://abc" }, "I'm a wedding photographer."],
    };
    const msgs = extractUserMessages(conv as any, 0);
    expect(msgs.map((m) => m.text)).toEqual(["I'm a wedding photographer."]);
  });

  it("returns nothing for a conversation without a mapping", () => {
    expect(extractUserMessages({ title: "broken" } as any, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sentences and classification
// ---------------------------------------------------------------------------

describe("splitSentences", () => {
  it("drops code fences and splits on sentence boundaries and lines", () => {
    const text = "I prefer tabs. Why does this fail?\n```js\nconst a = 1;\n```\n- I use pnpm\n- I never use yarn";
    expect(splitSentences(text)).toEqual(["I prefer tabs.", "Why does this fail?", "I use pnpm", "I never use yarn"]);
  });

  it("strips markdown emphasis and headings", () => {
    expect(splitSentences("## About\n**I am a** _teacher_.")).toEqual(["About", "I am a teacher."]);
  });
});

describe("classifySentence", () => {
  it.each([
    ["I'm a staff product manager at a developer platform company.", "What I Do"],
    ["I work at Acme as a data engineer.", "What I Do"],
    ["I prefer TypeScript in strict mode.", "How I Work"],
    ["We use pnpm and Turborepo.", "How I Work"],
    ["Keep answers concise.", "How I Communicate"],
    ["Please always use British spelling.", "How I Communicate"],
    ["From now on, answer in bullet points.", "How I Communicate"],
    ["I love hiking and craft beer.", "What I'm Into"],
    ["I'm building a clipboard manager for macOS in Swift.", "What I'm Working On"],
    ["I live in Cleveland, Ohio.", "Context"],
    ["My timezone is America/New_York.", "Context"],
    ["I'm on a MacBook running macOS.", "Context"],
    ["Never use emojis.", "Boundaries"],
    ["Also, don't apologize so much.", "Boundaries"],
    ["I don't need long explanations!", "Boundaries"],
    ["I hate when you repeat my question back to me.", "Boundaries"],
  ])("files %j under %s", (sentence, section) => {
    expect(classifySentence(sentence)).toBe(section);
  });

  it.each([
    "Can you help me rewrite this paragraph?",
    "Write a haiku about rain.",
    "Fix the error in the code above.",
    "Explain NSPasteboard.",
    "I'm a bit confused by this.",
    "hi",
    "Here is the file I mentioned.",
    "I think the following is wrong.",
    "const x: number = 'a';",
    "See https://example.com for the spec.",
    "I want you to summarize this article.",
    "Thanks, that's perfect!",
  ])("rejects %j", (sentence) => {
    expect(classifySentence(sentence)).toBeNull();
  });

  it("keeps a request only when it carries a standing marker", () => {
    expect(classifySentence("Give me a summary of this.")).toBeNull();
    expect(classifySentence("Always give me a summary before the details.")).toBe("How I Communicate");
    expect(classifySentence("I want you to start with the answer, from now on.")).toBe("How I Work");
  });
});

describe("looksSecret", () => {
  it.each([
    "My email is someone@example.com",
    "Use key sk-live-abcdefghijklmnop1234567890 for this",
    "Call me at 440-555-0199 if needed",
    "Call me at (440) 555-0199",
    "The server is at 10.0.0.1",
    "Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlX3Nob3VsZF9iZV9sb25n",
    "My card is 4111 1111 1111 1111",
    "My SSN is 123-45-6789",
    "password: hunter2",
    "AKIAIOSFODNN7EXAMPLE is the id",
  ])("flags %j", (sentence) => {
    expect(looksSecret(sentence)).toBe(true);
  });

  it.each([
    "I prefer TypeScript in strict mode",
    "I have 12 years of experience",
    "Keep answers under 200 words",
    "I was born in 1985",
  ])("passes %j", (sentence) => {
    expect(looksSecret(sentence)).toBe(false);
  });
});

describe("normalizeFact and presentFact", () => {
  it("treats contractions, case, fillers, and punctuation as the same fact", () => {
    expect(normalizeFact("Also, I'm a nurse.")).toBe(normalizeFact("i am a nurse"));
    expect(normalizeFact("Please don't use emojis!")).toBe(normalizeFact("Do not use emojis"));
  });

  it("drops the imperative negation from boundaries so they read like the template", () => {
    expect(presentFact("Also, never use emojis.", "Boundaries")).toBe("Use emojis");
    expect(presentFact("Please do not ever apologize.", "Boundaries")).toBe("Apologize");
    expect(presentFact("I hate when you repeat my question.", "Boundaries")).toBe("I hate when you repeat my question");
  });

  it("capitalizes and strips trailing periods elsewhere", () => {
    expect(presentFact("btw i prefer tabs.", "How I Work")).toBe("I prefer tabs");
  });
});

// ---------------------------------------------------------------------------
// The distill pass
// ---------------------------------------------------------------------------

describe("distillMessages", () => {
  const messages: UserMessage[] = SAMPLE.flatMap((c, i) => extractUserMessages(c as any, i));

  it("ranks facts by how many conversations repeated them", () => {
    const result = distillMessages(messages, SAMPLE.length, ["conversations.json"], []);
    expect(result.facts[0]).toMatchObject({ text: "Use emojis", section: "Boundaries", conversations: 2 });
    expect(result.facts[0].examples).toEqual(["Refactor help", "Travel plans"]);
    expect(result.facts[0].firstSeen).toBe(1_700_000_000 + 120);
    expect(result.facts[0].lastSeen).toBe(1_730_000_000 + 240);
  });

  it("drops secret-shaped sentences and counts them", () => {
    const result = distillMessages(messages, SAMPLE.length, ["conversations.json"], []);
    expect(result.facts.some((f) => f.text.includes("example.com") || f.text.includes("10.0.0.1"))).toBe(false);
    expect(result.stats.redacted).toBe(1);
  });

  it("never reads assistant messages", () => {
    const result = distillMessages(messages, SAMPLE.length, ["conversations.json"], []);
    expect(result.facts.some((f) => /I am an assistant|I love emojis/.test(f.text))).toBe(false);
  });

  it("honors --min and --limit", () => {
    const min2 = distillMessages(messages, SAMPLE.length, [], [], { minConversations: 2 });
    expect(min2.facts.map((f) => f.text)).toEqual(["Use emojis"]);
    expect(min2.stats.uniqueFacts).toBeGreaterThan(1);

    const limited = distillMessages(messages, SAMPLE.length, [], [], { limit: 3 });
    expect(limited.facts).toHaveLength(3);
  });

  it("reports counts for the whole pass", () => {
    const result = distillMessages(messages, SAMPLE.length, ["conversations.json"], ["user.json"]);
    expect(result.stats.conversations).toBe(5);
    expect(result.stats.userMessages).toBe(messages.length);
    expect(result.stats.sentences).toBeGreaterThan(result.stats.candidates);
    expect(result.stats.skippedFiles).toEqual(["user.json"]);
  });
});

// ---------------------------------------------------------------------------
// Rendering, validation, merge
// ---------------------------------------------------------------------------

describe("renderDistilledProfile", () => {
  const messages: UserMessage[] = SAMPLE.flatMap((c, i) => extractUserMessages(c as any, i));
  const result = distillMessages(messages, SAMPLE.length, ["conversations.json"], []);

  it("produces a profile the parser accepts and the validator passes", () => {
    const content = renderDistilledProfile(result, "2026-10-28");
    const parsed = createParser().parse(content);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const validation = validateProfile(parsed.profile);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.filter((w) => w.code === "UNKNOWN_SECTION")).toEqual([]);
    expect([...parsed.profile.sections.keys()]).toContain("boundaries");
    expect(parsed.profile.sections.get("boundaries")!.content).toContain("- Use emojis");
  });

  it("only emits sections that have facts, in the template order", () => {
    const content = renderDistilledProfile(result, "2026-10-28");
    const headers = content.split("\n").filter((l) => l.startsWith("## "));
    expect(headers).toEqual([
      "## What I Do",
      "## How I Work",
      "## How I Communicate",
      "## What I'm Into",
      "## What I'm Working On",
      "## Context",
      "## Boundaries",
    ]);
    expect(content).toContain('created: "2026-10-28"');
    expect(content).toContain("Nothing here was inferred by a model");
  });

  it("writes a readable report with counts", () => {
    const report = renderDistillReport(result);
    expect(report).toContain("5 conversations");
    expect(report).toContain("Use emojis  (2 chats, last 2024-10)");
    expect(report).toContain("1 dropped because they contained something secret-shaped");
  });
});

describe("mergeIntoProfile", () => {
  const messages: UserMessage[] = SAMPLE.flatMap((c, i) => extractUserMessages(c as any, i));
  const result = distillMessages(messages, SAMPLE.length, [], [], { limit: 4 });

  it("adds missing lines to existing sections and creates absent ones", () => {
    const existing = ['---', 'schema_version: "1.1"', '---', '', '# Me', '', '## Boundaries', '', '- Over-explain things I already know', ''].join("\n");
    const merged = mergeIntoProfile(existing, result);
    expect(merged.added).toBe(4);
    expect(merged.content).toContain("- Over-explain things I already know\n- Use emojis");
    expect(merged.content).toContain("## What I Do\n\n- I'm a staff product manager");
    expect(merged.content.indexOf("## Boundaries")).toBeLessThan(merged.content.indexOf("## What I Do"));
  });

  it("does not repeat a fact that is already there in different punctuation", () => {
    const existing = ['---', 'schema_version: "1.1"', '---', '', '# Me', '', '## Boundaries', '', "- Please don't use emojis.", ''].join("\n");
    const merged = mergeIntoProfile(existing, result);
    expect(merged.content.match(/emojis/gi)).toHaveLength(1);
    expect(merged.added).toBe(3);
  });

  it("is a no-op when nothing is new", () => {
    const first = mergeIntoProfile('---\nschema_version: "1.1"\n---\n\n# Me\n', result);
    const second = mergeIntoProfile(first.content, result);
    expect(second.added).toBe(0);
    expect(second.content).toBe(first.content);
  });
});

// ---------------------------------------------------------------------------
// Opening exports: folder, bare JSON, zip, sharded
// ---------------------------------------------------------------------------

describe("openChatGptExport", () => {
  it("reads an unpacked folder and lists the files it skips", () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    const opened = openChatGptExport(dir);
    expect(opened.conversationFiles.map((f) => f.name)).toEqual(["conversations.json"]);
    expect(opened.skippedFiles).toEqual(["chat.html", "user.json"]);
  });

  it("accepts conversations.json directly", () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    const result = distillExport(join(dir, "conversations.json"));
    expect(result.stats.files).toEqual(["conversations.json"]);
    expect(result.stats.conversations).toBe(5);
  });

  it("reads the zip ChatGPT produces", () => {
    const zipPath = join(tempDir, "chatgpt-export.zip");
    writeFileSync(
      zipPath,
      buildZip([
        { name: "conversations.json", data: JSON.stringify(SAMPLE) },
        { name: "user.json", data: JSON.stringify({ email: "someone@example.com" }) },
        { name: "chat.html", data: "<html></html>" },
      ])
    );
    const result = distillExport(zipPath);
    expect(result.stats.files).toEqual(["conversations.json"]);
    expect(result.stats.skippedFiles).toEqual(["chat.html", "user.json"]);
    expect(result.facts[0].text).toBe("Use emojis");
  });

  it("follows export_manifest.json across sharded conversation files", () => {
    const dir = join(tempDir, "sharded");
    mkdirSync(dir);
    writeFileSync(join(dir, "conversations-000.json"), JSON.stringify(SAMPLE.slice(0, 2)));
    writeFileSync(join(dir, "conversations-001.json"), JSON.stringify(SAMPLE.slice(2)));
    writeFileSync(
      join(dir, "export_manifest.json"),
      JSON.stringify({ logical_files: { "conversations.json": { files: ["conversations-000.json", "conversations-001.json"] } } })
    );
    const result = distillExport(dir);
    expect(result.stats.files).toEqual(["conversations-000.json", "conversations-001.json"]);
    expect(result.stats.conversations).toBe(5);
    expect(result.facts[0]).toMatchObject({ text: "Use emojis", conversations: 2 });
  });

  it("explains itself when there is nothing to read", () => {
    const dir = join(tempDir, "empty");
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), "hello");
    expect(() => openChatGptExport(dir)).toThrow(/No conversations\.json found/);
    expect(() => openChatGptExport(join(tempDir, "missing.zip"))).toThrow(/Not found/);
  });

  it("rejects a non-zip file with a .zip extension", () => {
    const bad = join(tempDir, "bad.zip");
    writeFileSync(bad, "this is not a zip");
    expect(() => readZipEntries(readFileSync(bad))).toThrow(/Not a zip file/);
  });
});

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

describe("distillCommand", () => {
  const quiet = { quiet: true } as const;

  it("fails without an export path", async () => {
    expect(await distillCommand([], { ...quiet })).toBe(1);
  });

  it("writes a draft to -o and refuses to overwrite without --force", async () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    const out = join(tempDir, "out", ".you.md");
    expect(await distillCommand([dir], { ...quiet, output: out })).toBe(0);
    expect(existsSync(out)).toBe(true);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("## Boundaries");
    expect(content).toContain("- Use emojis");
    expect(content).not.toContain("example.com");

    expect(await distillCommand([dir], { ...quiet, output: out })).toBe(1);
    expect(await distillCommand([dir], { ...quiet, output: out, force: true })).toBe(0);
  });

  it("merges into an existing profile and is idempotent", async () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    const out = join(tempDir, ".you.md");
    writeFileSync(out, '---\nschema_version: "1.1"\n---\n\n# Me\n\n## How I Work\n\n- I prefer TypeScript in strict mode\n');
    expect(await distillCommand([dir], { ...quiet, output: out, merge: true })).toBe(0);
    const once = readFileSync(out, "utf-8");
    expect(once.match(/strict mode/g)).toHaveLength(1);
    expect(once).toContain("## Boundaries");
    expect(await distillCommand([dir], { ...quiet, output: out, merge: true })).toBe(0);
    expect(readFileSync(out, "utf-8")).toBe(once);
  });

  it("refuses --merge when the profile does not exist", async () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    expect(await distillCommand([dir], { ...quiet, output: join(tempDir, "nope.md"), merge: true })).toBe(1);
  });

  it("rejects bad --min and --limit values", async () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    expect(await distillCommand([dir], { ...quiet, dryRun: true, min: "0" })).toBe(1);
    expect(await distillCommand([dir], { ...quiet, dryRun: true, limit: "abc" })).toBe(1);
    expect(await distillCommand([dir], { ...quiet, dryRun: true, min: "2", limit: "5" })).toBe(0);
  });

  it("writes nothing in --dry-run and --json modes", async () => {
    const dir = writeExportFolder(join(tempDir, "export"));
    const out = join(tempDir, "dry.md");
    const log = console.log;
    const lines: string[] = [];
    console.log = (s: string) => void lines.push(String(s));
    try {
      expect(await distillCommand([dir], { ...quiet, output: out, dryRun: true })).toBe(0);
      expect(await distillCommand([dir], { ...quiet, output: out, json: true })).toBe(0);
    } finally {
      console.log = log;
    }
    expect(existsSync(out)).toBe(false);
    expect(lines[0]).toContain("5 conversations");
    const json = JSON.parse(lines[1]);
    expect(json.facts[0]).toMatchObject({ text: "Use emojis", conversations: 2 });
    expect(json.stats.redacted).toBe(1);
  });

  it("exits 1 when the export holds nothing durable", async () => {
    const dir = writeExportFolder(join(tempDir, "export"), [SAMPLE[4]]);
    expect(await distillCommand([dir], { ...quiet, output: join(tempDir, "none.md") })).toBe(1);
    expect(existsSync(join(tempDir, "none.md"))).toBe(false);
  });
});
