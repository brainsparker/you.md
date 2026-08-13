/**
 * Shared formatting helpers for turning a parsed you.md profile into
 * text suitable for injection into an AI tool's context.
 *
 * Used by both the MCP server (youmd_get_preferences, youmd_tool_config)
 * and the CLI export command.
 */

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
