import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createParser } from "../parser/index.js";
import { getDefaultTemplate } from "../cli/templates/default.js";
import { formatProfileForContext, type FormattableProfile } from "../core/formatter.js";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const parser = createParser();

/**
 * Check whether a target path is inside the user's home directory or cwd.
 * Rejects writes to arbitrary system locations (e.g. /etc, /tmp).
 */
export function isPathSafe(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  const home = homedir();
  const cwd = process.cwd();
  return (
    resolved.startsWith(home + "/") ||
    resolved === home ||
    resolved.startsWith(cwd + "/") ||
    resolved === cwd
  );
}

/**
 * Create and run the MCP server for you-md
 */
export async function createMcpServer(): Promise<Server> {
  const server = new Server(
    {
      name: "you-md",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [];

    // Check for you.md in various locations
    const locations = [
      { path: resolve(".you.md"), name: "Project you.md", uri: "youmd://project" },
      { path: resolve("you.md"), name: "Project you.md", uri: "youmd://project" },
      { path: resolve(homedir(), ".you.md"), name: "Global you.md", uri: "youmd://global" },
      { path: resolve(homedir(), ".config/you.md"), name: "Global you.md (XDG)", uri: "youmd://global" },
    ];

    const seen = new Set<string>();
    for (const loc of locations) {
      if (existsSync(loc.path) && !seen.has(loc.uri)) {
        resources.push({
          uri: loc.uri,
          name: loc.name,
          description: `Your preferences from ${loc.path}`,
          mimeType: "text/markdown",
        });
        seen.add(loc.uri);
      }
    }

    // Always show merged as an option if any exist
    if (resources.length > 0) {
      resources.unshift({
        uri: "youmd://preferences",
        name: "Your Preferences",
        description: "Your merged you.md preferences (project overrides global)",
        mimeType: "text/markdown",
      });
    }

    return { resources };
  });

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "youmd://preferences") {
      // Return merged preferences
      const result = await parser.discover();

      if (!result || !result.success) {
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: "No you.md file found. Create one with: `you-md init ~/.you.md`",
            },
          ],
        };
      }

      // Format preferences for context
      const formatted = formatPreferencesForContext(result.profile);

      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: formatted,
          },
        ],
      };
    }

    if (uri === "youmd://project") {
      const projectPath = existsSync(resolve(".you.md"))
        ? resolve(".you.md")
        : resolve("you.md");

      if (!existsSync(projectPath)) {
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: "No project you.md found.",
            },
          ],
        };
      }

      const result = await parser.loadFromPath(projectPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: result.profile.rawContent,
          },
        ],
      };
    }

    if (uri === "youmd://global") {
      const globalPaths = [
        resolve(homedir(), ".you.md"),
        resolve(homedir(), ".config/you.md"),
      ];

      for (const p of globalPaths) {
        if (existsSync(p)) {
          const result = await parser.loadFromPath(p);
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: result.profile.rawContent,
              },
            ],
          };
        }
      }

      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: "No global you.md found.",
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "youmd_init",
          description: "Create a new you.md file with a template",
          inputSchema: {
            type: "object" as const,
            properties: {
              path: {
                type: "string",
                description: "Path to create the file (default: ~/.you.md)",
              },
              force: {
                type: "boolean",
                description: "Overwrite existing file",
              },
            },
          },
        },
        {
          name: "youmd_validate",
          description: "Validate a you.md file",
          inputSchema: {
            type: "object" as const,
            properties: {
              path: {
                type: "string",
                description: "Path to the you.md file to validate",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "youmd_get_preferences",
          description: "Get the user's you.md preferences for the current context",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        {
          name: "youmd_summarize",
          description:
            "Get a one-paragraph summary of who the user is and how they like to work — useful for quick context injection at the start of a session",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        {
          name: "youmd_tool_config",
          description:
            "Generate a tool-specific configuration snippet (e.g. Cursor rules, Claude system prompt fragment) from the user's you.md preferences",
          inputSchema: {
            type: "object" as const,
            properties: {
              tool: {
                type: "string",
                description: "Target tool: cursor | claude | windsurf | generic",
                enum: ["cursor", "claude", "windsurf", "generic"],
              },
            },
            required: ["tool"],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "youmd_init") {
      const path = (args?.path as string) || resolve(homedir(), ".you.md");
      const force = args?.force as boolean;

      if (!isPathSafe(path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Refused: path "${path}" is outside your home directory and current working directory. Provide a path under ~ or the project root.`,
            },
          ],
        };
      }

      if (existsSync(path) && !force) {
        return {
          content: [
            {
              type: "text" as const,
              text: `File already exists: ${path}\nUse force: true to overwrite.`,
            },
          ],
        };
      }

      const template = getDefaultTemplate();
      await writeFile(path, template, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `Created you.md at: ${path}\n\nEdit the file to add your preferences.`,
          },
        ],
      };
    }

    if (name === "youmd_validate") {
      const path = args?.path as string;
      if (!path) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: path is required",
            },
          ],
        };
      }

      const result = await parser.loadFromPath(path);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Validation failed:\n${result.errors.map((e) => `- ${e.code}: ${e.message}`).join("\n")}`,
            },
          ],
        };
      }

      const validation = parser.validate(result.profile);

      if (!validation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Validation failed:\n${validation.errors.map((e) => `- ${e.code}: ${e.message}`).join("\n")}`,
            },
          ],
        };
      }

      let response = `✓ Valid: ${path}`;
      if (validation.warnings.length > 0) {
        response += `\n\nWarnings:\n${validation.warnings.map((w) => `- ${w.code}: ${w.message}`).join("\n")}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: response,
          },
        ],
      };
    }

    if (name === "youmd_get_preferences") {
      const result = await parser.discover();

      if (!result || !result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No you.md file found. Create one with the youmd_init tool.",
            },
          ],
        };
      }

      const formatted = formatPreferencesForContext(result.profile);

      return {
        content: [
          {
            type: "text" as const,
            text: formatted,
          },
        ],
      };
    }

    if (name === "youmd_summarize") {
      const result = await parser.discover()

      if (!result || !result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No you.md file found. Run `you-md init -i` to create one, or `you-md skill install` to set up the skill.",
            },
          ],
        }
      }

      const summary = buildSummary(result.profile)

      return {
        content: [
          {
            type: "text" as const,
            text: summary,
          },
        ],
      }
    }

    if (name === "youmd_tool_config") {
      const tool = (args?.tool as string) || "generic"
      const result = await parser.discover()

      if (!result || !result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No you.md file found. Run `you-md init -i` to create one.",
            },
          ],
        }
      }

      const config = buildToolConfig(result.profile, tool)

      return {
        content: [
          {
            type: "text" as const,
            text: config,
          },
        ],
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Format a profile for injection into AI context.
 * Delegates to the shared formatter used by the CLI export command.
 */
function formatPreferencesForContext(profile: FormattableProfile): string {
  return formatProfileForContext(profile);
}

type Profile = FormattableProfile

/**
 * Build a concise one-paragraph summary of the user for quick context injection
 */
function buildSummary(profile: Profile): string {
  const lines: string[] = []

  if (profile.metadata.author) {
    lines.push(`This session is with ${profile.metadata.author}.`)
  }

  const sectionTexts: string[] = []
  for (const [, section] of profile.sections) {
    if (section.content?.trim()) {
      sectionTexts.push(`${section.title}: ${section.content.trim().slice(0, 120)}`)
    }
  }

  if (sectionTexts.length > 0) {
    lines.push(sectionTexts.slice(0, 4).join(". ") + ".")
  }

  if (lines.length === 0) {
    return "User preferences are defined in you.md but no summary could be generated. Use youmd_get_preferences for full details."
  }

  return lines.join(" ")
}

/**
 * Generate a tool-specific configuration snippet from the user's profile
 */
function buildToolConfig(profile: Profile, tool: string): string {
  const prefs = formatPreferencesForContext(profile)

  switch (tool) {
    case "cursor":
      return `# .cursorrules — generated from you.md\n# Do not edit manually; regenerate with: you-md skill install\n\n${prefs}`

    case "claude":
      return `<user_preferences>\nThe following preferences are from the user's you.md file. Apply them throughout this session.\n\n${prefs}\n</user_preferences>`

    case "windsurf":
      return `# Windsurf rules — generated from you.md\n\n${prefs}`

    default:
      return `# AI tool preferences — generated from you.md\n# Install the skill in your tools with: you-md skill install\n\n${prefs}`
  }
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if executed directly
main().catch(console.error);
