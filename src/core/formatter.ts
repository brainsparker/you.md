/**
 * Shared formatting helpers for turning a parsed you.md profile into
 * text suitable for injection into an AI tool's context.
 *
 * Used by both the MCP server (youmd_get_preferences, youmd_tool_config)
 * and the CLI export command.
 *
 * Audience directives (`<!-- you-md: private -->` and friends) are never
 * rendered. Callers that know their target should scope the profile first
 * with scopeProfile(); the stripping here is a safety net for the rest.
 */

import { stripDirectives } from "./audience";

/**
 * The minimal structural shape needed to format a profile.
 * Matches YouMdProfile but stays structural so callers can pass
 * partial profiles (e.g. in tests).
 */
export interface FormattableProfile {
  sections: Map<
    string,
    {
      title: string;
      content: string;
      subsections: { title: string; content: string }[];
    }
  >;
  metadata: { author?: string };
}

/**
 * Format a profile for injection into AI context
 */
export function formatProfileForContext(profile: FormattableProfile): string {
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
    const content = stripDirectives(section.content);
    if (content) {
      lines.push(content);
      lines.push("");
    }
    for (const sub of section.subsections) {
      lines.push(`### ${sub.title}`);
      lines.push("");
      const subContent = stripDirectives(sub.content);
      if (subContent) {
        lines.push(subContent);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
