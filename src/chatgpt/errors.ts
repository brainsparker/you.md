/**
 * Errors raised by the ChatGPT app layer.
 *
 * Every error carries a stable `code` so tool handlers can translate it into a
 * message the model can act on without pattern-matching prose.
 */

export type ChatGptErrorCode =
  | "INVALID_PROFILE"
  | "PROFILE_EXISTS"
  | "PROFILE_NOT_FOUND"
  | "STALE_VERSION"
  | "UNAUTHORIZED"
  | "STORAGE_ERROR";

export class ChatGptAppError extends Error {
  readonly code: ChatGptErrorCode;

  constructor(code: ChatGptErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The submitted markdown is not a usable you.md profile. */
export class InvalidProfileError extends ChatGptAppError {
  /** Human-readable reasons, one per problem found. */
  readonly reasons: string[];

  constructor(message: string, reasons: string[] = []) {
    super("INVALID_PROFILE", message);
    this.reasons = reasons;
  }
}

/** create_profile was called but the user already has a profile. */
export class ProfileExistsError extends ChatGptAppError {
  readonly profileId: string;
  readonly version: number;

  constructor(profileId: string, version: number) {
    super(
      "PROFILE_EXISTS",
      `A profile already exists (version ${version}). Use youmd_update_profile to change it.`
    );
    this.profileId = profileId;
    this.version = version;
  }
}

/** get/update/export was called before the user has a profile. */
export class ProfileNotFoundError extends ChatGptAppError {
  constructor() {
    super(
      "PROFILE_NOT_FOUND",
      "No profile exists yet. Use youmd_create_profile to create one."
    );
  }
}

/** update_profile was called against a version that is no longer current. */
export class StaleVersionError extends ChatGptAppError {
  readonly currentVersion: number;
  readonly baseVersion: number;

  constructor(baseVersion: number, currentVersion: number) {
    super(
      "STALE_VERSION",
      `Update rejected: base_version ${baseVersion} is stale, the current version is ${currentVersion}. ` +
        `Call youmd_get_profile to fetch the latest markdown, re-apply the edit, and retry.`
    );
    this.baseVersion = baseVersion;
    this.currentVersion = currentVersion;
  }
}

/** The request carried no usable identity. */
export class UnauthorizedError extends ChatGptAppError {
  constructor(message = "Missing or invalid credentials.") {
    super("UNAUTHORIZED", message);
  }
}
