/**
 * Distill engine for `you-md distill <chatgpt-export>`.
 *
 * Reads a ChatGPT data export (the zip from Settings > Data controls >
 * Export data, the unpacked folder, or a bare conversations.json) and mines
 * the user's own messages for durable first-person facts: role, stack,
 * working habits, communication preferences, standing rules. Facts are
 * ranked by how many separate conversations repeated them, secrets are
 * dropped, and the result is a you.md draft for the user to review.
 *
 * Pure heuristics. No model call, no network, no new dependencies.
 * Assistant messages are never read: the profile should come from what
 * the user said about themselves, not from what a model inferred.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { CURRENT_SCHEMA_VERSION, SENSITIVE_PATTERNS } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DistillSection =
  | "What I Do"
  | "How I Work"
  | "How I Communicate"
  | "What I'm Into"
  | "What I'm Working On"
  | "Context"
  | "Boundaries";

/** Order sections appear in the rendered draft */
export const DISTILL_SECTION_ORDER: DistillSection[] = [
  "What I Do",
  "How I Work",
  "How I Communicate",
  "What I'm Into",
  "What I'm Working On",
  "Context",
  "Boundaries",
];

export interface UserMessage {
  /** Message text (string parts joined) */
  text: string;
  /** Unix seconds, if the export carried one */
  time: number | null;
  /** Conversation id or synthesized index key */
  conversationId: string;
  /** Conversation title, for the report */
  conversationTitle: string;
}

export interface DistilledFact {
  /** Text as it will appear in the profile */
  text: string;
  /** Dedupe key */
  normalized: string;
  section: DistillSection;
  /** Number of distinct conversations that stated this fact */
  conversations: number;
  /** Unix seconds of the first and last sighting, when known */
  firstSeen: number | null;
  lastSeen: number | null;
  /** Up to three conversation titles, for the report */
  examples: string[];
}

export interface DistillStats {
  /** Conversation files that were read */
  files: string[];
  /** Files present in the export that were deliberately not read */
  skippedFiles: string[];
  conversations: number;
  userMessages: number;
  sentences: number;
  /** Sentences that looked like a durable fact before dedupe */
  candidates: number;
  /** Sentences dropped because they contained something secret-shaped */
  redacted: number;
  /** Facts after dedupe and before --min / --limit */
  uniqueFacts: number;
}

export interface DistillResult {
  facts: DistilledFact[];
  stats: DistillStats;
}

export interface DistillOptions {
  /** Keep only facts seen in at least this many conversations (default 1) */
  minConversations?: number;
  /** Keep at most this many facts (default 60) */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Reading the export: zip, folder, or a single JSON file
// ---------------------------------------------------------------------------

interface ExportFile {
  name: string;
  read: () => Buffer;
}

const CONVERSATION_FILE = /^conversations(?:[-_]\d+)?\.json$/i;
const MANIFEST_FILE = "export_manifest.json";
/** Files every export may carry that are never profile content */
const KNOWN_NON_PROFILE_FILES = [
  "user.json",
  "message_feedback.json",
  "model_comparisons.json",
  "shared_conversations.json",
  "ads.json",
  "chat.html",
];

/**
 * Open an export at `inputPath`, whatever shape it has, and return the
 * conversation files plus the files that were present and skipped.
 */
export function openChatGptExport(inputPath: string): {
  conversationFiles: ExportFile[];
  skippedFiles: string[];
} {
  if (!existsSync(inputPath)) {
    throw new Error(`Not found: ${inputPath}`);
  }

  const stat = statSync(inputPath);
  let files: ExportFile[];

  if (stat.isDirectory()) {
    files = readdirSync(inputPath)
      .filter((name) => {
        try {
          return statSync(join(inputPath, name)).isFile();
        } catch {
          return false;
        }
      })
      .map((name) => ({ name, read: () => readFileSync(join(inputPath, name)) }));
  } else if (extname(inputPath).toLowerCase() === ".zip") {
    files = readZipEntries(readFileSync(inputPath));
  } else {
    files = [{ name: basename(inputPath), read: () => readFileSync(inputPath) }];
  }

  // Shards named by the manifest win; filename pattern is the fallback.
  const byBase = new Map<string, ExportFile>();
  for (const f of files) byBase.set(basename(f.name).toLowerCase(), f);

  let conversationFiles: ExportFile[] = [];
  const manifest = byBase.get(MANIFEST_FILE);
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.read().toString("utf-8"));
      const listed: unknown = parsed?.logical_files?.["conversations.json"]?.files;
      if (Array.isArray(listed)) {
        for (const name of listed) {
          if (typeof name !== "string") continue;
          const f = byBase.get(basename(name).toLowerCase());
          if (f) conversationFiles.push(f);
        }
      }
    } catch {
      // A broken manifest is not fatal; fall through to filename matching.
    }
  }

  if (conversationFiles.length === 0) {
    conversationFiles = files
      .filter((f) => CONVERSATION_FILE.test(basename(f.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // A single JSON file given directly is accepted whatever it is called.
  if (conversationFiles.length === 0 && files.length === 1 && extname(files[0].name).toLowerCase() === ".json") {
    conversationFiles = files;
  }

  if (conversationFiles.length === 0) {
    throw new Error(
      `No conversations.json found in ${inputPath}. Pass the export zip, the unpacked folder, or conversations.json itself.`
    );
  }

  const skippedFiles = files
    .map((f) => basename(f.name))
    .filter((name) => KNOWN_NON_PROFILE_FILES.includes(name.toLowerCase()))
    .sort();

  return { conversationFiles, skippedFiles };
}

/**
 * Minimal zip reader (stored and deflate entries, no ZIP64, no encryption).
 * Enough for the export OpenAI produces; anything else gets a clear error.
 */
export function readZipEntries(buf: Buffer): ExportFile[] {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  // End of central directory sits in the last 22 bytes plus an optional comment.
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record)");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cenOffset === 0xffffffff) {
    throw new Error("This zip uses ZIP64, which the built-in reader does not support. Unzip it and pass the folder instead.");
  }

  const entries: ExportFile[] = [];
  let pos = cenOffset;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) {
      throw new Error("Corrupt zip central directory");
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("This zip uses ZIP64, which the built-in reader does not support. Unzip it and pass the folder instead.");
    }

    entries.push({
      name,
      read: () => {
        if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`Corrupt zip local header for ${name}`);
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const data = buf.subarray(start, start + compressedSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
        throw new Error(`Unsupported zip compression method ${method} for ${name}`);
      },
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Walking conversations
// ---------------------------------------------------------------------------

interface RawNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: RawMessage | null;
}

interface RawMessage {
  author?: { role?: string };
  create_time?: number | null;
  content?: { content_type?: string; parts?: unknown[] };
  metadata?: { is_visually_hidden_from_conversation?: boolean };
}

interface RawConversation {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  mapping?: Record<string, RawNode>;
  current_node?: string;
}

/**
 * Parse one conversations file into its conversation objects.
 */
export function parseConversationsFile(content: string): RawConversation[] {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed.filter((c) => c && typeof c === "object");
  if (parsed && typeof parsed === "object" && parsed.mapping) return [parsed];
  throw new Error("conversations.json is not an array of conversations");
}

/**
 * Return the user's own messages on the branch they last saw.
 *
 * The export stores each conversation as a tree: edits and regenerations
 * create sibling branches, and `current_node` points at the leaf of the
 * active one. Walking parent pointers from there gives the conversation as
 * the user remembers it, without abandoned drafts.
 */
export function extractUserMessages(conv: RawConversation, index: number): UserMessage[] {
  const mapping = conv.mapping;
  if (!mapping || typeof mapping !== "object") return [];

  const conversationId = conv.conversation_id || conv.id || `conversation-${index}`;
  const conversationTitle = (conv.title || "").trim() || "Untitled";

  // Active branch: current_node up to the root.
  const chain: RawNode[] = [];
  const visited = new Set<string>();
  let cursor: string | null | undefined = conv.current_node;
  while (cursor && mapping[cursor] && !visited.has(cursor)) {
    visited.add(cursor);
    const node: RawNode = mapping[cursor];
    chain.push(node);
    cursor = node.parent;
  }
  chain.reverse();

  // Fallback: no usable current_node, so walk from the root following the
  // last child at each branch (the most recent regeneration).
  if (chain.length === 0) {
    const rootId = Object.keys(mapping).find((id) => !mapping[id].parent);
    const seen = new Set<string>();
    let id: string | undefined = rootId;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      const node: RawNode = mapping[id];
      chain.push(node);
      const children = node.children || [];
      id = children[children.length - 1];
    }
  }

  const out: UserMessage[] = [];
  for (const node of chain) {
    const msg = node.message;
    if (!msg || msg.author?.role !== "user") continue;
    if (msg.metadata?.is_visually_hidden_from_conversation) continue;
    const type = msg.content?.content_type;
    if (type && type !== "text" && type !== "multimodal_text") continue;
    const parts = Array.isArray(msg.content?.parts) ? msg.content!.parts! : [];
    const text = parts
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
    if (!text) continue;
    out.push({
      text,
      time: typeof msg.create_time === "number" ? msg.create_time : null,
      conversationId,
      conversationTitle,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/**
 * Split a message into candidate sentences. Code fences are removed whole
 * (a profile should never contain pasted code), then the text is split on
 * line breaks and sentence punctuation.
 */
export function splitSentences(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const out: string[] = [];
  for (const line of withoutFences.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "") // list markers
      .replace(/^\s*#{1,6}\s+/, "") // headings
      .replace(/^\s*>\s?/, "") // quotes
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // emphasis
      .trim();
    if (!cleaned) continue;
    for (const piece of cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)) {
      const s = piece.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** Anything matching these never reaches the profile. Aggressive on purpose. */
export const SECRET_SHAPES: RegExp[] = [
  ...SENSITIVE_PATTERNS,
  /[\w.+-]+@[\w-]+\.[\w.-]{2,}/, // email address
  /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|xox[abprs])[-_][A-Za-z0-9_-]{10,}/, // vendor key prefixes
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b[A-Za-z0-9_-]{40,}\b/, // long opaque token
  /https?:\/\/[^\s/]+:[^\s/]+@/, // URL with embedded credentials
  /\b(?:\d[ -]?){13,19}\b/, // card-like digit run
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN shape
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // phone number
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IPv4
  /\b(?:password|passwd|passphrase|pwd)\b\s*(?:is|was|:|=)/i,
];

export function looksSecret(sentence: string): boolean {
  return SECRET_SHAPES.some((re) => re.test(sentence));
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Sentences that reference something only the original chat could see */
const DEICTIC = /\b(?:this|that|the above|the below|below|attached|the following|following|here is|here's|see above|the error|the code|the file|the output|the screenshot|the image|the doc|the draft|my message|your (?:answer|response|reply|code|version))\b/i;

/** One-off task language. Only kept when a standing marker is present. */
const REQUEST = /^(?:(?:please|pls|plz|ok|okay|now|so|also|and)\s+)*(?:can|could|would|will) you\b|^(?:(?:please|pls|plz|ok|okay|now|so|also|and)\s+)*(?:i(?:'d| would) like you to|i need you to|i want you to|help me|give me|show me|write|rewrite|fix|explain|summarize|summarise|translate|generate|create|make|draft|list|tell me|check|review|debug|convert|improve|refactor|analyze|analyse|describe|find|compare|calculate|suggest|recommend|outline|format)\b/i;

/** Markers that turn a request into a standing rule */
const STANDING = /\b(?:always|never|from now on|going forward|in general|generally|by default|every time|whenever|in (?:all|every|future) (?:chats?|conversations?|responses?|answers?)|for (?:all|every) (?:future )?(?:chats?|conversations?|responses?|answers?)|unless i (?:ask|say)|as a rule|in the future)\b/i;

/** Leading fillers to strip before matching. "Yes" and "no" only count as
 * filler when punctuated ("No, I prefer tabs"), so "No emojis" survives. */
const FILLER = /^(?:(?:also|btw|fyi|note|and|but|so|well|ok|okay|yeah|oh|hey|hi|hello|thanks|thank you|actually|basically|honestly|again|first|second|finally|lastly|additionally|importantly|for context|for reference|context|background)[,:!.]?\s+|(?:yes|no|nope|yep)[,:!.]\s+)+/i;

interface Rule {
  section: DistillSection;
  pattern: RegExp;
}

/**
 * Rules are checked in order; the first match decides the section.
 * Imperative prohibitions come first because a bare "never" beats any
 * other signal: it is the clearest thing a person can say to an assistant.
 */
const RULES: Rule[] = [
  {
    section: "Boundaries",
    pattern: /^(?:please\s+)?(?:never|don't|dont|do not|avoid|stop|no need to|quit|refrain from|don't ever|do not ever|please no|no more)\b|^(?:i (?:hate|dislike|can't stand|cannot stand|don't like|do not like|don't want|do not want|don't need|do not need|need no|have no use for|really don't like|really dislike)|i'd rather you (?:not|didn't|never)|i would rather you (?:not|didn't|never)|it (?:annoys|bothers|frustrates|irritates) me when)\b/i,
  },
  {
    // A style preference reads like a preference or an instruction. The
    // leading lookahead keeps narration ("I wrote a short story") out.
    section: "How I Communicate",
    pattern: /^(?=(?:i (?:prefer|like|want|need|hate|dislike|don't|do not|love|expect|appreciate|would|'d|am|'m)|please|always|never|keep|be|use|respond|answer|reply|write|talk|give|explain|format|start|end|no|avoid|don't|do not|from now on|going forward|when|stop|skip|include|put|lead|try|make|only|just|less|more|fewer|shorter|longer|call|address|treat|speak|sound|get)\b).*\b(?:concise|concisely|brief|briefly|short|shorter|lengthy|wordy|long-winded|rambling|verbose|verbosity|terse|detailed answers?|long answers?|tone|formal|informal|casual|friendly|blunt|direct|straightforward|bullet points?|bulleted|numbered lists?|emojis?|exclamation (?:marks|points)|jargon|plain (?:english|language)|simple (?:terms|language|words)|explain(?:ations?)? (?:like|as if)|eli5|step[- ]by[- ]step|tl;?dr|summar(?:y|ies|ize|ise|ized|ised)|answer first|get to the point|bottom line|markdown|headings?|tables?|code (?:blocks?|first|only)|examples? (?:first|only|please)|no fluff|no filler|no preamble|no caveats|no disclaimers|no hedging|hedging|caveats|sugarcoat|cheerleading|flattery|don't apologize|stop apologizing|respond in|reply in|answer in|write in|talk to me|address me|call me|use (?:british|american|canadian|australian) (?:english|spelling))\b/i,
  },
  {
    section: "What I Do",
    pattern: /^(?:i'?m|i am)\s+(?:a|an|the)\s+(?!fan\b|bit\b|little\b|huge\b|big\b)|^(?:i (?:work|worked|am working|'m working) (?:as|at|in|for|on the)|my (?:job|role|title|day job|company|team|employer|boss|manager|coworkers?|colleagues?|clients?|customers?|startup|business|practice|lab|department|students?|classes?)\b|i (?:run|lead|manage|own|founded|co-founded|teach|study|am studying|'m studying|'m a student|am a student|freelance|consult|am self-employed|'m self-employed|am retired|'m retired)\b|i(?:'ve| have) (?:been|worked|spent) .*\b(?:years?|decades?)\b|i (?:have|'ve got) \d+ years?\b|my (?:background|experience|expertise|career|profession|industry|field) (?:is|was|has been)|i specialize in|i specialise in|i am (?:responsible|in charge) (?:for|of)|i'm (?:responsible|in charge) (?:for|of))/i,
  },
  {
    section: "Context",
    pattern: /^(?:i (?:live|'m based|am based|'m located|am located|reside|'m from|am from|grew up|was born|moved)\b|my (?:timezone|time zone|location|city|country|native language|first language|mother tongue|primary language|locale|region|home)\b|i (?:speak|'m fluent|am fluent|'m learning .*\b(?:language|spanish|french|german|japanese|chinese|mandarin|portuguese|italian|korean|arabic|hindi)\b)|i(?:'m| am) (?:on|using) (?:a |an )?(?:mac(?:book| mini| studio|os)?|windows|linux|ubuntu|fedora|arch|debian|iphone|ipad|android|pixel|chromebook)\b|i (?:use|have|own|'m on|am on) (?:a |an )?(?:mac(?:book| mini| studio|os)?|windows (?:\d+|pc|laptop|machine)|linux (?:box|machine|laptop|desktop)|ubuntu|fedora|arch|debian|iphone|ipad|android|pixel|chromebook|m[1-4] (?:pro|max|ultra|air|macbook))\b|i (?:am|'m) (?:color ?blind|colour ?blind|dyslexic|deaf|hard of hearing|blind|visually impaired|neurodivergent|autistic|adhd)\b|i have (?:adhd|dyslexia|a disability|low vision|a screen reader)\b|i use a screen reader|it(?:'s| is) currently .*\b(?:am|pm|o'clock)\b|i(?:'m| am) (?:a )?(?:night owl|morning person|early riser)\b)/i,
  },
  {
    section: "What I'm Into",
    pattern: /^(?:i (?:love|enjoy|adore|'m into|am into|'m interested in|am interested in|'m passionate about|am passionate about|'m obsessed with|am obsessed with|'m a (?:big |huge )?fan of|am a (?:big |huge )?fan of|follow|collect|play|read a lot of|watch a lot of|listen to a lot of|'m learning|am learning|'m getting into|am getting into|'m curious about|am curious about)\b|my (?:hobby|hobbies|interests?|favorite|favourite|passion|guilty pleasure)\b)/i,
  },
  {
    section: "What I'm Working On",
    pattern: /^(?:i(?:'m| am) (?:currently )?(?:working on|building|writing|developing|designing|launching|shipping|prototyping|preparing for|training for|studying for|planning|organizing|organising)\b|my (?:current |main |side |latest |new )?(?:project|side project|thesis|dissertation|book|novel|app|product|course|startup idea|goal (?:this|for)|deadline|launch)\b|we(?:'re| are) (?:currently )?(?:building|working on|launching|migrating|shipping|rewriting)\b|this (?:quarter|year|month|semester) i(?:'m| am)\b)/i,
  },
  {
    section: "How I Work",
    pattern: /^(?:i (?:prefer|like|love|tend|usually|normally|typically|generally|always|never|mostly|often|rarely|like to|try to|insist on|stick to|default to|lean toward|lean towards|favor|favour|avoid|swear by|refuse to|only use|use|write|code|work|deploy|test|ship|build|organize|organise|plan|think|learn|read|take notes|manage|track)\b|my (?:stack|setup|workflow|process|approach|style|preference|preferences|convention|conventions|rule of thumb|go-to|editor|ide|terminal|shell|os|machine|laptop|dotfiles|tooling|toolchain|framework|language of choice)\b|we (?:use|prefer|always|never|follow|run|deploy|work|ship|standardize|standardise)\b|our (?:stack|codebase|team uses|convention|conventions|style guide|workflow|process)\b|please (?:always|use|prefer|keep|stick to|follow|assume|remember|default to|treat)\b|always (?:use|prefer|assume|keep|include|follow|write|default|respond|answer|reply|format|start|end)\b|assume (?:i|that i|i'm|i am|i know|i have)\b|when (?:i ask|you (?:write|answer|respond|reply|generate|explain|suggest|give))\b.*\b(?:always|never|prefer|use|keep|include|avoid|don't|do not)\b|treat me (?:as|like)\b|i'd rather|i would rather|i'd prefer|i would prefer|unless i (?:say|ask|tell)\b|from now on\b|going forward\b|by default\b|in general i\b)/i,
  },
];

/** Minimum and maximum sentence lengths that can be a fact */
const MIN_LEN = 12;
const MAX_LEN = 240;

/**
 * Decide whether a sentence is a durable first-person fact, and which
 * section it belongs in. Returns null for anything that is not.
 */
export function classifySentence(raw: string): DistillSection | null {
  let s = raw.trim().replace(/\s+/g, " ");
  s = s.replace(FILLER, "");
  if (s.length < MIN_LEN || s.length > MAX_LEN) return null;
  if (/[?]\s*$/.test(s)) return null; // questions are never facts about you
  if (/[{}<>]|=>|\bfunction\b|\bconst\b|\bimport\b|\\n|\$\{/.test(s)) return null; // code-shaped
  if (/https?:\/\//i.test(s)) return null; // links belong in What I Trust, by hand
  if (DEICTIC.test(s)) return null;

  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.6) return null; // mostly symbols or digits

  const standing = STANDING.test(s);
  if (REQUEST.test(s) && !standing) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(s)) return rule.section;
  }

  // A standing instruction with no other home is a working preference.
  if (standing && /^(?:i|please|you|always|never|when)\b/i.test(s)) return "How I Work";

  return null;
}

// ---------------------------------------------------------------------------
// Normalization, cleanup, dedupe
// ---------------------------------------------------------------------------

/**
 * Dedupe key: lowercase, contractions expanded, punctuation stripped.
 */
export function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(FILLER, "")
    .replace(/\bi['’]m\b/g, "i am")
    .replace(/\bi['’]ve\b/g, "i have")
    .replace(/\bi['’]d\b/g, "i would")
    .replace(/\bi['’]ll\b/g, "i will")
    .replace(/\bdon['’]?t\b/g, "do not")
    .replace(/\bdoesn['’]?t\b/g, "does not")
    .replace(/\bcan['’]?t\b/g, "cannot")
    .replace(/\bwon['’]?t\b/g, "will not")
    .replace(/\bisn['’]?t\b/g, "is not")
    .replace(/\bpls\b|\bplz\b/g, "please")
    .replace(/^please\s+/, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Present a sentence as a profile line: fillers gone, first letter
 * capitalized, trailing period removed. Boundaries drop their imperative
 * negation so they read like the template ("Use emojis" under Boundaries,
 * not "Don't use emojis").
 */
export function presentFact(raw: string, section: DistillSection): string {
  let s = raw.trim().replace(/\s+/g, " ").replace(FILLER, "");
  s = s.replace(/^please\s+/i, "");
  if (section === "Boundaries") {
    s = s.replace(/^(?:never|don't|dont|do not|avoid|stop|quit|refrain from|please no|no more|no need to)\s+(?:ever\s+)?/i, "");
    s = s.replace(/^(?:ever\s+)/i, "");
  }
  s = s.replace(/[.!]+$/, "").trim();
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// The distill pass
// ---------------------------------------------------------------------------

interface Accumulator {
  section: DistillSection;
  presented: string;
  conversationIds: Set<string>;
  firstSeen: number | null;
  lastSeen: number | null;
  examples: string[];
}

/**
 * Run the full pass over already-extracted user messages.
 */
export function distillMessages(
  messages: UserMessage[],
  conversationCount: number,
  files: string[],
  skippedFiles: string[],
  options: DistillOptions = {}
): DistillResult {
  const minConversations = Math.max(1, options.minConversations ?? 1);
  const limit = Math.max(1, options.limit ?? 60);

  const acc = new Map<string, Accumulator>();
  let sentences = 0;
  let candidates = 0;
  let redacted = 0;

  for (const msg of messages) {
    for (const sentence of splitSentences(msg.text)) {
      sentences++;
      const section = classifySentence(sentence);
      if (!section) continue;
      if (looksSecret(sentence)) {
        redacted++;
        continue;
      }
      candidates++;

      const presented = presentFact(sentence, section);
      if (presented.length < 3) continue;
      const key = `${section}|${normalizeFact(presented)}`;
      let entry = acc.get(key);
      if (!entry) {
        entry = {
          section,
          presented,
          conversationIds: new Set(),
          firstSeen: null,
          lastSeen: null,
          examples: [],
        };
        acc.set(key, entry);
      }
      entry.conversationIds.add(msg.conversationId);
      if (msg.time !== null) {
        entry.firstSeen = entry.firstSeen === null ? msg.time : Math.min(entry.firstSeen, msg.time);
        entry.lastSeen = entry.lastSeen === null ? msg.time : Math.max(entry.lastSeen, msg.time);
      }
      if (entry.examples.length < 3 && !entry.examples.includes(msg.conversationTitle)) {
        entry.examples.push(msg.conversationTitle);
      }
    }
  }

  const all: DistilledFact[] = [...acc.entries()].map(([key, e]) => ({
    text: e.presented,
    normalized: key.slice(key.indexOf("|") + 1),
    section: e.section,
    conversations: e.conversationIds.size,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    examples: e.examples,
  }));

  // Most repeated first, then most recent, then alphabetical for stability.
  all.sort((a, b) => {
    if (b.conversations !== a.conversations) return b.conversations - a.conversations;
    const al = a.lastSeen ?? 0;
    const bl = b.lastSeen ?? 0;
    if (bl !== al) return bl - al;
    return a.text.localeCompare(b.text);
  });

  const facts = all.filter((f) => f.conversations >= minConversations).slice(0, limit);

  return {
    facts,
    stats: {
      files,
      skippedFiles,
      conversations: conversationCount,
      userMessages: messages.length,
      sentences,
      candidates,
      redacted,
      uniqueFacts: all.length,
    },
  };
}

/**
 * Open an export and distill it in one call.
 */
export function distillExport(inputPath: string, options: DistillOptions = {}): DistillResult {
  const { conversationFiles, skippedFiles } = openChatGptExport(inputPath);
  const messages: UserMessage[] = [];
  let conversationCount = 0;
  const files: string[] = [];

  for (const file of conversationFiles) {
    const conversations = parseConversationsFile(file.read().toString("utf-8"));
    files.push(basename(file.name));
    for (const conv of conversations) {
      messages.push(...extractUserMessages(conv, conversationCount));
      conversationCount++;
    }
  }

  return distillMessages(messages, conversationCount, files, skippedFiles, options);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function groupBySection(facts: DistilledFact[]): Map<DistillSection, DistilledFact[]> {
  const groups = new Map<DistillSection, DistilledFact[]>();
  for (const section of DISTILL_SECTION_ORDER) groups.set(section, []);
  for (const f of facts) groups.get(f.section)!.push(f);
  return groups;
}

/**
 * Render a complete you.md draft from the distilled facts.
 */
export function renderDistilledProfile(result: DistillResult, today = new Date().toISOString().split("T")[0]): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`schema_version: "${CURRENT_SCHEMA_VERSION}"`);
  lines.push(`created: "${today}"`);
  lines.push('privacy_level: "private"');
  lines.push("---");
  lines.push("");
  lines.push("# Me");
  lines.push("");
  lines.push("<!--");
  lines.push(`  Draft distilled from a ChatGPT export on ${today}:`);
  lines.push(
    `  ${result.stats.conversations} conversations, ${result.stats.userMessages} of your messages, ${result.facts.length} lines kept.`
  );
  lines.push("  Every line below is something you said in a chat. Delete what is stale,");
  lines.push("  reword what is clumsy, and remove anything you would not want every AI");
  lines.push("  tool to know. Nothing here was inferred by a model.");
  lines.push("-->");
  lines.push("");

  for (const [section, facts] of groupBySection(result.facts)) {
    if (facts.length === 0) continue;
    lines.push(`## ${section}`);
    lines.push("");
    for (const f of facts) lines.push(`- ${f.text}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Append facts the profile does not already have. Sections that exist get
 * the new bullets at their end; missing sections are added before the
 * first trailing blank lines. Lines are compared by normalized text so a
 * fact already present in different punctuation is not repeated.
 */
export function mergeIntoProfile(existing: string, result: DistillResult): { content: string; added: number } {
  // Existing lines are indexed both as written and with a leading negation
  // removed, so "Please don't use emojis" already covers a distilled
  // Boundaries line of "Use emojis".
  const existingKeys = new Set<string>();
  for (const line of existing.split(/\r?\n/)) {
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (!stripped) continue;
    const key = normalizeFact(stripped);
    existingKeys.add(key);
    existingKeys.add(key.replace(/^(?:never|do not|avoid|stop|quit|no more|no need to)\s+(?:ever\s+)?/, ""));
  }

  const fresh = result.facts.filter((f) => !existingKeys.has(f.normalized));
  if (fresh.length === 0) return { content: existing, added: 0 };

  let lines = existing.replace(/\s+$/, "").split(/\r?\n/);
  const groups = groupBySection(fresh);

  for (const [section, facts] of groups) {
    if (facts.length === 0) continue;
    const headerIndex = lines.findIndex((l) => {
      const m = /^(#{1,6})\s+(.+?)\s*$/.exec(l);
      return m && m[2].toLowerCase() === section.toLowerCase();
    });

    if (headerIndex === -1) {
      lines.push("", `## ${section}`, "", ...facts.map((f) => `- ${f.text}`));
      continue;
    }

    // Section ends at the next header of the same or higher level.
    const level = /^(#{1,6})/.exec(lines[headerIndex])![1].length;
    let end = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const m = /^(#{1,6})\s+/.exec(lines[i]);
      if (m && m[1].length <= level) {
        end = i;
        break;
      }
    }
    // Insert before the section's trailing blank lines. An empty section
    // gets a blank line between its header and the first bullet.
    let insertAt = end;
    while (insertAt > headerIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    const bullets = facts.map((f) => `- ${f.text}`);
    if (insertAt === headerIndex + 1) bullets.unshift("");
    lines.splice(insertAt, 0, ...bullets);
  }

  return { content: lines.join("\n") + "\n", added: fresh.length };
}

function monthOf(unix: number | null): string {
  if (unix === null) return "unknown";
  return new Date(unix * 1000).toISOString().slice(0, 7);
}

/**
 * Human-readable report for --dry-run and the post-write summary.
 */
export function renderDistillReport(result: DistillResult): string {
  const s = result.stats;
  const out: string[] = [];
  out.push(`Read ${s.files.join(", ")}`);
  if (s.skippedFiles.length > 0) {
    out.push(`Skipped ${s.skippedFiles.join(", ")} (account data and feedback, never profile content)`);
  }
  out.push(
    `${s.conversations} conversations, ${s.userMessages} messages from you, ${s.sentences} sentences, ${s.candidates} looked durable, ${s.uniqueFacts} unique after dedupe`
  );
  if (s.redacted > 0) {
    out.push(`${s.redacted} dropped because they contained something secret-shaped (email, key, phone, card, IP)`);
  }
  out.push("");

  if (result.facts.length === 0) {
    out.push("Nothing durable found. Try --min 1 or check that the export contains your messages.");
    return out.join("\n");
  }

  for (const [section, facts] of groupBySection(result.facts)) {
    if (facts.length === 0) continue;
    out.push(`## ${section}`);
    for (const f of facts) {
      const chats = f.conversations === 1 ? "1 chat" : `${f.conversations} chats`;
      const when = f.lastSeen === null ? "" : `, last ${monthOf(f.lastSeen)}`;
      out.push(`  ${f.text}  (${chats}${when})`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
