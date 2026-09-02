/**
 * Instruction-file injection scanner.
 *
 * A you.md profile is injected into an AI tool's context, either through the
 * MCP server or by `you-md export` writing it into CLAUDE.md, AGENTS.md,
 * GEMINI.md, and rules files. That makes the profile an instruction file in
 * the same class attackers now target: a shared or remotely loaded profile
 * can carry text that tells the agent to ignore its other instructions, hide
 * actions from the user, ship prompts or environment variables to an outside
 * endpoint, or redirect API traffic through a proxy.
 *
 * This module is a static, dependency-free scan for the technique families
 * documented in the wild (authority override, concealment, exfiltration,
 * endpoint and permission overrides, hidden content, remote instruction
 * loading, piped execution). It is deliberately conservative: it flags
 * instruction-shaped text, not vocabulary. Ordinary profile lines such as
 * "Ignore minor style issues" or "Do not add speculative abstractions" do
 * not match.
 *
 * Findings are surfaced as validation warnings (POSSIBLE_INJECTION) so a
 * personal profile is never rejected outright on a false positive; the CLI
 * `--strict` flag turns them into a failing exit code for CI and for
 * reviewing profiles you did not write yourself.
 *
 * Suppress a known-good line by placing `<!-- you-md:allow-injection -->`
 * on that line, or alone on the line directly above it.
 */

/**
 * Technique families a finding can belong to.
 */
export type InjectionCategory =
  | "authority_override"
  | "concealment"
  | "exfiltration"
  | "endpoint_override"
  | "permission_bypass"
  | "hidden_content"
  | "remote_instruction"
  | "piped_execution";

/**
 * Finding severity. "high" is instruction-shaped text with a clear hostile
 * reading; "medium" is a carrier that is suspicious in a profile but has
 * legitimate uses elsewhere.
 */
export type InjectionSeverity = "high" | "medium";

/**
 * A single scanner finding.
 */
export interface InjectionFinding {
  /** Stable rule identifier, e.g. "YM-INJ-001" */
  readonly ruleId: string;

  /** Technique family */
  readonly category: InjectionCategory;

  /** Severity */
  readonly severity: InjectionSeverity;

  /** Human-readable description of what was matched and why it matters */
  readonly message: string;

  /** 1-based line number in the scanned content */
  readonly line: number;

  /** The matched text, trimmed for display */
  readonly excerpt: string;
}

/**
 * Options for the scanner.
 */
export interface InjectionScanOptions {
  /** Maximum excerpt length in characters (default: 80) */
  readonly excerptLength?: number;
}

interface InjectionRule {
  readonly id: string;
  readonly category: InjectionCategory;
  readonly severity: InjectionSeverity;
  readonly message: string;
  readonly patterns: readonly RegExp[];
}

/**
 * Marker that suppresses findings. Inline, it covers its own line; alone on
 * a line, it covers the line below.
 */
export const INJECTION_ALLOW_MARKER = "you-md:allow-injection";

const ALLOW_MARKER_ONLY_LINE = /^<!--\s*you-md:allow-injection\b[^>]*-->\s*$/;

const DEFAULT_EXCERPT_LENGTH = 80;

/** Minimum run of base64 characters treated as an opaque payload. */
const BASE64_BLOB_MIN_LENGTH = 120;

/**
 * Zero-width and bidirectional control characters: U+200B..U+200F,
 * U+202A..U+202E, U+2060..U+2064, U+2066..U+2069, and U+FEFF. Invisible in
 * most editors and diff views, fully visible to a model.
 */
const INVISIBLE_CHARACTER_PATTERN =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const INVISIBLE_CHARACTER_PATTERN_GLOBAL = new RegExp(
  INVISIBLE_CHARACTER_PATTERN.source,
  "g"
);

/**
 * Hosts that show up as exfiltration sinks in published incident reports.
 * Matching one in a profile is a strong signal on its own.
 */
const EXFIL_HOST_PATTERN =
  /\b(?:[a-z0-9-]+\.)*(?:webhook\.site|pipedream\.net|requestbin\.(?:com|net)|requestcatcher\.com|burpcollaborator\.net|oastify\.com|interact\.sh|oast\.(?:fun|live|me|online|pro|site)|ngrok(?:-free)?\.(?:app|io|dev)|api\.telegram\.org\/bot|discord(?:app)?\.com\/api\/webhooks)\b/i;

const SENSITIVE_MATERIAL =
  "(?:\\.env\\b|env(?:ironment)? var(?:iable)?s?|api[ _-]?keys?|access[ _-]?keys?|secrets?|tokens?|credentials?|passwords?|prompts?|conversation|chat history|ssh keys?|private keys?|\\bkeychain\\b)";

const RULES: readonly InjectionRule[] = [
  {
    id: "YM-INJ-001",
    category: "authority_override",
    severity: "high",
    message:
      "Text that tells the agent to discard or override its other instructions. A profile advises the agent, it does not outrank system or project policy.",
    patterns: [
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|other|existing|system|developer|safety)\s+(?:\w+\s+){0,2}?(?:instructions?|prompts?|rules?|guidelines?|policies|policy|constraints?|guardrails?)/i,
      /\b(?:this|the following)\s+(?:file|document|profile|section|rule|instruction)s?\s+(?:is|are|takes?|has|have)\s+(?:\w+\s+){0,2}?(?:authoritative|canonical|precedence|priority)\s+over\b/i,
      /\btakes?\s+precedence\s+over\s+(?:\w+\s+){0,3}?(?:instructions?|prompts?|rules?|policies|policy|system)/i,
      /\b(?:supersedes?|overrides?)\s+(?:all\s+|any\s+)?(?:other\s+|system\s+|user\s+|project\s+)?(?:instructions?|prompts?|rules?|policies|policy|configuration)/i,
      /\byou\s+(?:must|shall|will)\s+(?:always\s+)?(?:obey|comply\s+with|follow)\s+(?:this|these)\s+(?:file|document|instructions?|rules?)\s+(?:above|over|before|regardless)/i,
      /\b(?:new|updated|real|actual|true)\s+system\s+prompt\s*:/i,
      /\bjailbreak\b|\bDAN\s+mode\b|\bdeveloper\s+mode\s+enabled\b/i,
    ],
  },
  {
    id: "YM-INJ-002",
    category: "concealment",
    severity: "high",
    message:
      "Text that tells the agent to hide an action or its output from the user. Legitimate preferences never need the user kept in the dark.",
    patterns: [
      /\b(?:do\s+not|don't|never|without)\s+(?:\w+\s+){0,2}?(?:tell|telling|mention|mentioning|inform|informing|notify|notifying|show|showing|reveal|revealing|disclose|disclosing|alert|alerting|ask|asking|warn|warning)\s+(?:this\s+(?:to\s+)?)?the\s+(?:user|human|developer|operator)\b/i,
      /\b(?:silently|quietly|covertly|discreetly|invisibly)\s+(?:\w+\s+){0,3}?(?:send|post|upload|call|fetch|curl|exfiltrate|forward|transmit)\b/i,
      /\b(?:silently|quietly|covertly|discreetly|invisibly)\s+(?:\w+\s+){0,3}?(?:run|execute)\b[^\n]*(?:https?:\/\/|\bcurl\b|\bwget\b)/i,
      /\b(?:send|post|upload|call|fetch|curl|forward|transmit)\s+(?:\w+\s+){0,6}?(?:silently|quietly|covertly|in\s+the\s+background\s+without)\b/i,
      /\b(?:hide|suppress|conceal|omit)\s+(?:this|the|that|any|all)\s+(?:\w+\s+){0,2}?(?:command|action|step|request|call|output|response|activity|behaviou?r)s?\s+(?:\w+\s+){0,3}?(?:from|to)\s+the\s+(?:user|human|developer|operator|logs?|transcript)\b/i,
      /\b(?:do\s+not|don't|never)\s+(?:\w+\s+){0,2}?(?:log|record|include|mention)\s+(?:this|that|it)\s+(?:in|to)\s+(?:the\s+)?(?:response|output|transcript|summary|logs?|audit)\b/i,
    ],
  },
  {
    id: "YM-INJ-003",
    category: "exfiltration",
    severity: "high",
    message:
      "Text that moves prompts, environment variables, secrets, or files to an outside endpoint. This is the PromptLogger pattern reported in poisoned instruction files.",
    patterns: [
      new RegExp(
        `\\b(?:send|post|upload|forward|transmit|copy|sync|push|ship|report|exfiltrate|submit)\\s+(?:\\w+\\s+){0,4}?${SENSITIVE_MATERIAL}\\s+(?:\\w+\\s+){0,4}?to\\s+(?:https?:\\/\\/|[a-z0-9-]+\\.[a-z]{2,}\\b|(?:an?\\s+)?(?:external|remote|outside|third[- ]party)\\s+(?:endpoint|server|service|url|webhook))`,
        "i"
      ),
      new RegExp(
        `\\b(?:curl|wget|fetch|http\\.post|requests\\.post|axios\\.post|Invoke-WebRequest|Invoke-RestMethod)\\b[^\\n]{0,160}?(?:\\$\\{?[A-Z_]{3,}\\}?|\\$\\(\\s*(?:env|printenv|cat\\s+[^\\n]*\\.env)|\\benv\\b|printenv|\\.env\\b|~\\/\\.(?:ssh|aws|config|netrc|npmrc|gitconfig)\\b)`,
        "i"
      ),
      new RegExp(
        `\\b(?:cat|type|read|dump|print|echo)\\s+(?:\\w+\\s+){0,2}?(?:~\\/\\.(?:ssh|aws|config|netrc|npmrc)\\b|\\.env\\b|(?:api[ _-]?keys?|secrets?|credentials?))\\s+(?:\\w+\\s+){0,4}?(?:and\\s+)?(?:send|post|upload|pipe|forward|curl)\\b`,
        "i"
      ),
      EXFIL_HOST_PATTERN,
    ],
  },
  {
    id: "YM-INJ-004",
    category: "endpoint_override",
    severity: "high",
    message:
      "An API base URL override. Redirecting model traffic to another host lets that host read, log, or modify every conversation.",
    patterns: [
      /\b(?:ANTHROPIC|OPENAI|GEMINI|GOOGLE_GENAI|MISTRAL|COHERE|AZURE_OPENAI|OLLAMA|CLAUDE_CODE)_(?:BASE_URL|API_BASE|API_HOST|ENDPOINT|BASE_URL_OVERRIDE)\s*[:=]/i,
      /\b(?:base_?url|api_?base|api_?endpoint|proxy_?url)\s*[:=]\s*["']?https?:\/\/(?!(?:api\.)?(?:anthropic|openai|googleapis|mistral|cohere)\.com\b)[^\s"']+/i,
      /\b(?:set|export|configure|point|route|redirect)\s+(?:\w+\s+){0,3}?(?:api|model|claude|anthropic|openai|llm)\s+(?:\w+\s+){0,2}?(?:traffic|requests?|calls?|endpoint|base\s+url)\s+(?:\w+\s+){0,2}?(?:to|through|via)\s+(?:https?:\/\/|[a-z0-9-]+\.[a-z]{2,}\b)/i,
    ],
  },
  {
    id: "YM-INJ-005",
    category: "permission_bypass",
    severity: "high",
    message:
      "Text that disables tool approval or permission prompts. Instruction files should never ask the agent to run without the user's consent.",
    patterns: [
      /--dangerously-skip-permissions\b/i,
      /\b(?:bypassPermissions|skipPermissions|dangerouslySkipPermissions|acceptEdits\s*[:=]\s*true|yolo(?:[ _-]?mode)?)\b/i,
      /\b(?:auto[- ]?approve|auto[- ]?accept|auto[- ]?allow|approve\s+automatically|accept\s+automatically)\s+(?:\w+\s+){0,3}?(?:all\s+|every\s+|any\s+)?(?:tool\s+calls?|commands?|edits?|actions?|permissions?|prompts?|requests?)/i,
      /\b(?:disable|turn\s+off|skip|suppress|bypass|ignore)\s+(?:\w+\s+){0,3}?(?:permission|approval|confirmation|consent|safety)\s+(?:prompts?|checks?|dialogs?|requests?|gates?)/i,
      /\ballowedTools\s*[:=]\s*\[?\s*["']\*["']/i,
    ],
  },
  {
    id: "YM-INJ-006",
    category: "hidden_content",
    severity: "medium",
    message:
      "Content that is invisible or unreadable to a human reviewer but readable by the agent: zero-width or bidirectional control characters, an HTML comment addressed to the agent, or a long opaque payload.",
    patterns: [
      INVISIBLE_CHARACTER_PATTERN,
      /<!--(?![^>]*you-md:)[^>]*\b(?:ignore|disregard|you\s+must|you\s+should|assistant|agent|system\s+prompt|instruction|execute|run\s+the|curl|wget|send|secret|token|api[ _-]?key)\b[^>]*-->/i,
      new RegExp(`(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{${BASE64_BLOB_MIN_LENGTH},}={0,2}(?![A-Za-z0-9+/=])`),
      /\]\(\s*(?:javascript|data|vbscript)\s*:/i,
    ],
  },
  {
    id: "YM-INJ-007",
    category: "remote_instruction",
    severity: "medium",
    message:
      "Text that tells the agent to fetch instructions from a URL and follow or run them. Whoever controls that URL controls the agent.",
    patterns: [
      /\b(?:follow|apply|obey|adopt|load|read|use)\s+(?:the\s+|all\s+|any\s+)?(?:\w+\s+){0,2}?(?:instructions?|rules?|directives?|commands?|policy|policies|prompts?|guidance)\s+(?:\w+\s+){0,2}?(?:at|from|in|hosted\s+(?:at|on))\s+https?:\/\//i,
      /\b(?:fetch|download|retrieve|pull|get|curl|wget)\s+(?:\w+\s+){0,6}?https?:\/\/\S+\s+(?:\w+\s+){0,3}?(?:and\s+)?(?:then\s+)?(?:execute|run|eval|follow|apply|obey|source|install)\b/i,
      /\b(?:always|first|before\s+(?:\w+\s+){0,3}?)\s+(?:fetch|load|read|check|consult)\s+https?:\/\/\S+\s+(?:\w+\s+){0,3}?(?:for|and\s+follow|and\s+apply)\s+(?:\w+\s+){0,2}?(?:instructions?|rules?|updates?|directives?)/i,
    ],
  },
  {
    id: "YM-INJ-008",
    category: "piped_execution",
    severity: "medium",
    message:
      "A download piped straight into a shell or interpreter, or an eval of fetched content. Nothing a preferences file needs to ask for.",
    patterns: [
      /\b(?:curl|wget|fetch|Invoke-WebRequest|iwr)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/i,
      /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby|php)\b/i,
      /\b(?:eval|exec)\s*\(\s*(?:await\s+)?(?:fetch|requests?\.get|urlopen|http\.get|curl|wget|\$\(\s*curl)/i,
      /\bbash\s+-c\s+["']?\s*\$\(\s*(?:curl|wget)/i,
      /\b(?:base64\s+(?:-d|--decode)|atob\s*\()\s*[^\n|]{0,120}?\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i,
    ],
  },
];

/**
 * All scanner rules, exposed for documentation and testing.
 */
export const INJECTION_RULES: readonly {
  readonly id: string;
  readonly category: InjectionCategory;
  readonly severity: InjectionSeverity;
  readonly message: string;
}[] = RULES.map(({ id, category, severity, message }) => ({
  id,
  category,
  severity,
  message,
}));

/**
 * Scan raw you.md content (or any Markdown instruction file) for
 * instruction-file poisoning patterns.
 *
 * Scanning is line-based so every finding carries a line number a reviewer
 * can jump to. Each rule reports at most once per line. A line is skipped
 * when it carries the allow marker inline, or when the line above it
 * consists of nothing but the allow marker.
 *
 * @param content - Raw file content
 * @param options - Scanner options
 * @returns Findings ordered by line, then rule id
 */
export function scanForInjection(
  content: string,
  options?: InjectionScanOptions
): InjectionFinding[] {
  if (!content) {
    return [];
  }

  const excerptLength = options?.excerptLength ?? DEFAULT_EXCERPT_LENGTH;
  const lines = content.split(/\r?\n/);
  const findings: InjectionFinding[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length === 0) {
      continue;
    }

    if (isAllowedInline(line) || (index > 0 && isAllowMarkerLine(lines[index - 1]))) {
      continue;
    }

    for (const rule of RULES) {
      const match = firstMatch(line, rule.patterns);
      if (match === null) {
        continue;
      }

      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.message,
        line: index + 1,
        excerpt: buildExcerpt(match, excerptLength),
      });
    }
  }

  return findings;
}

/**
 * True when the content contains at least one high-severity finding.
 */
export function hasHighSeverityFindings(findings: readonly InjectionFinding[]): boolean {
  return findings.some((f) => f.severity === "high");
}

/**
 * Format findings as human-readable lines for CLI output.
 *
 * @param findings - Scanner findings
 * @returns One formatted string per finding
 */
export function formatInjectionFindings(findings: readonly InjectionFinding[]): string[] {
  return findings.map((f) => {
    const sev = f.severity === "high" ? "HIGH" : "MEDIUM";
    return `${f.ruleId} [${sev} ${f.category}] line ${f.line}: "${f.excerpt}"`;
  });
}

function isAllowedInline(line: string): boolean {
  return line.includes(INJECTION_ALLOW_MARKER);
}

function isAllowMarkerLine(line: string): boolean {
  return ALLOW_MARKER_ONLY_LINE.test(line.trim());
}

function firstMatch(line: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[0].length > 0) {
      return match[0];
    }
  }
  return null;
}

function buildExcerpt(matched: string, maxLength: number): string {
  // Make invisible characters visible in the excerpt so a reviewer can see
  // what was actually flagged.
  const visible = matched.replace(
    INVISIBLE_CHARACTER_PATTERN_GLOBAL,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
  );
  const collapsed = visible.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 3)}...`;
}
