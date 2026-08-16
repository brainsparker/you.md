/**
 * Product telemetry for the ChatGPT app.
 *
 * Profile text never leaves this process through telemetry. Emitters receive
 * counts, durations, and outcomes — nothing a profile could be reconstructed
 * from. `userId` is the internal opaque id, never the ChatGPT account.
 */

export type TelemetryEvent =
  | "app_connected"
  | "profile_generation_started"
  | "profile_created"
  | "profile_updated"
  | "profile_exported"
  | "profile_deleted"
  | "profile_rejected";

export interface TelemetryProperties {
  readonly profile_section_count?: number;
  readonly profile_word_count?: number;
  readonly profile_version?: number;
  readonly number_of_edits?: number;
  readonly export_format?: string;
  readonly error_code?: string;
  readonly [key: string]: string | number | boolean | undefined;
}

export interface Telemetry {
  track(
    event: TelemetryEvent,
    userId: string,
    properties?: TelemetryProperties
  ): void;
}

/** Drops everything. The default, so tests and libraries stay silent. */
export class NoopTelemetry implements Telemetry {
  track(): void {
    // intentionally empty
  }
}

/**
 * Writes one JSON object per line to stderr, ready to be shipped by whatever
 * log drain the deployment already has.
 */
export class ConsoleTelemetry implements Telemetry {
  constructor(private readonly write: (line: string) => void = (line) =>
    process.stderr.write(line + "\n")) {}

  track(
    event: TelemetryEvent,
    userId: string,
    properties: TelemetryProperties = {}
  ): void {
    const record = {
      type: "youmd_telemetry",
      event,
      user_id: userId,
      timestamp: new Date().toISOString(),
      ...stripText(properties),
    };
    this.write(JSON.stringify(record));
  }
}

/**
 * Guard against a caller accidentally attaching profile content: string
 * properties are capped at a length no meaningful profile text fits into.
 */
function stripText(properties: TelemetryProperties): TelemetryProperties {
  const safe: Record<string, string | number | boolean | undefined> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && value.length > 64) {
      safe[key] = `${value.slice(0, 61)}...`;
      continue;
    }
    safe[key] = value;
  }

  return safe;
}

export function createTelemetryFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Telemetry {
  return env.YOUMD_TELEMETRY === "console"
    ? new ConsoleTelemetry()
    : new NoopTelemetry();
}
