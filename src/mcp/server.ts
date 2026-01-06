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
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const parser = createParser();

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
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "youmd_init") {
      const path = (args?.path as string) || resolve(homedir(), ".you.md");
      const force = args?.force as boolean;

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

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Format a profile for injection into AI context
 */
function formatPreferencesForContext(profile: {
  sections: Map<string, { title: string; content: string; subsections: { title: string; content: string }[] }>;
  metadata: { author?: string };
}): string {
  const lines: string[] = [];

  lines.push("# User Preferences (from you.md)");
  lines.push("");

  if (profile.metadata.author) {
    lines.push(`Author: ${profile.metadata.author}`);
    lines.push("");
  }

  for (const [, section] of profile.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (section.content) {
      lines.push(section.content);
      lines.push("");
    }
    for (const sub of section.subsections) {
      lines.push(`### ${sub.title}`);
      lines.push("");
      if (sub.content) {
        lines.push(sub.content);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
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
