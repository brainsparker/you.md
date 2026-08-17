/**
 * Storage contracts for the ChatGPT app.
 *
 * Markdown is the canonical artifact. `structured` is advisory metadata the
 * model may attach; nothing in the service reads it back.
 */

/** Where a given version of the markdown came from. */
export type ProfileSource = "chatgpt" | "user" | "import";

export interface ProfileRecord {
  readonly profileId: string;
  readonly userId: string;
  readonly version: number;
  readonly markdown: string;
  readonly structured: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileVersionRecord {
  readonly profileId: string;
  readonly version: number;
  readonly markdown: string;
  readonly source: ProfileSource;
  readonly createdAt: string;
}

export interface CreateProfileInput {
  readonly userId: string;
  readonly markdown: string;
  readonly structured?: Record<string, unknown> | null;
  readonly source?: ProfileSource;
}

export interface UpdateProfileInput {
  readonly userId: string;
  readonly markdown: string;
  /** Version the edit was based on. Rejected if it is not the current version. */
  readonly baseVersion: number;
  readonly structured?: Record<string, unknown> | null;
  readonly source?: ProfileSource;
}

/**
 * One profile per user, versioned. Implementations must scope every read and
 * write by `userId` — cross-user access is the failure this interface exists to
 * make hard.
 */
export interface ProfileStore {
  /**
   * Map an external identity onto a stable internal user id, creating the user
   * on first sight.
   */
  resolveUserId(provider: string, providerUserId: string): Promise<string>;

  /** Current profile for a user, or null if they have none. */
  getProfile(userId: string): Promise<ProfileRecord | null>;

  /** Create the user's first profile. Throws ProfileExistsError if one exists. */
  createProfile(input: CreateProfileInput): Promise<ProfileRecord>;

  /**
   * Replace the canonical markdown. Throws ProfileNotFoundError if there is no
   * profile and StaleVersionError if `baseVersion` is not current.
   */
  updateProfile(input: UpdateProfileInput): Promise<ProfileRecord>;

  /** Version history, newest first. */
  listVersions(userId: string): Promise<ProfileVersionRecord[]>;

  /** Delete the profile and its history. Returns false if there was none. */
  deleteProfile(userId: string): Promise<boolean>;

  /** Release any underlying connections. */
  close?(): Promise<void>;
}
