import { randomUUID } from "node:crypto";

import {
  ProfileExistsError,
  ProfileNotFoundError,
  StaleVersionError,
} from "../errors.js";
import type {
  CreateProfileInput,
  ProfileRecord,
  ProfileStore,
  ProfileSource,
  ProfileVersionRecord,
  UpdateProfileInput,
} from "./types.js";

/**
 * The slice of a Postgres driver this store needs. `pg`'s Pool and Client both
 * satisfy it, so the driver stays an optional dependency of the deployment
 * rather than of this package.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

interface ProfileRow {
  id: string;
  user_id: string;
  current_version: number | string;
  markdown: string;
  structured: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface VersionRow {
  profile_id: string;
  version: number | string;
  markdown: string;
  source: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toProfileRecord(row: ProfileRow): ProfileRecord {
  return {
    profileId: row.id,
    userId: row.user_id,
    version: Number(row.current_version),
    markdown: row.markdown,
    structured: row.structured ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * Postgres-backed store. Schema lives in `apps/chatgpt/schema.sql`.
 *
 * Create and update are single statements so concurrent calls from two
 * conversations cannot interleave into a lost write; the uniqueness of
 * `profiles.user_id` and the `current_version` guard do the work.
 */
export class PostgresProfileStore implements ProfileStore {
  constructor(private readonly sql: SqlClient) {}

  async resolveUserId(provider: string, providerUserId: string): Promise<string> {
    const { rows } = await this.sql.query<{ id: string }>(
      `INSERT INTO youmd_users (id, provider, provider_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_user_id)
         DO UPDATE SET provider = EXCLUDED.provider
       RETURNING id`,
      [newId("usr"), provider, providerUserId]
    );
    return rows[0].id;
  }

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    const { rows } = await this.sql.query<ProfileRow>(
      `SELECT id, user_id, current_version, markdown, structured, created_at, updated_at
       FROM youmd_profiles WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ? toProfileRecord(rows[0]) : null;
  }

  async createProfile(input: CreateProfileInput): Promise<ProfileRecord> {
    const source: ProfileSource = input.source ?? "chatgpt";
    const { rows } = await this.sql.query<ProfileRow>(
      `WITH created AS (
         INSERT INTO youmd_profiles (id, user_id, current_version, markdown, structured)
         VALUES ($1, $2, 1, $3, $4::jsonb)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id, user_id, current_version, markdown, structured, created_at, updated_at
       ), versioned AS (
         INSERT INTO youmd_profile_versions (id, profile_id, version, markdown, source)
         SELECT $5, id, 1, markdown, $6 FROM created
       )
       SELECT * FROM created`,
      [
        newId("prof"),
        input.userId,
        input.markdown,
        input.structured ? JSON.stringify(input.structured) : null,
        newId("pver"),
        source,
      ]
    );

    if (!rows[0]) {
      const existing = await this.getProfile(input.userId);
      // The insert can only no-op because a profile already exists.
      throw new ProfileExistsError(
        existing?.profileId ?? "unknown",
        existing?.version ?? 1
      );
    }

    return toProfileRecord(rows[0]);
  }

  async updateProfile(input: UpdateProfileInput): Promise<ProfileRecord> {
    const source: ProfileSource = input.source ?? "chatgpt";
    const { rows } = await this.sql.query<ProfileRow>(
      `WITH updated AS (
         UPDATE youmd_profiles
         SET markdown = $2,
             structured = COALESCE($3::jsonb, structured),
             current_version = current_version + 1,
             updated_at = now()
         WHERE user_id = $1 AND current_version = $4
         RETURNING id, user_id, current_version, markdown, structured, created_at, updated_at
       ), versioned AS (
         INSERT INTO youmd_profile_versions (id, profile_id, version, markdown, source)
         SELECT $5, id, current_version, markdown, $6 FROM updated
       )
       SELECT * FROM updated`,
      [
        input.userId,
        input.markdown,
        input.structured ? JSON.stringify(input.structured) : null,
        input.baseVersion,
        newId("pver"),
        source,
      ]
    );

    if (!rows[0]) {
      const current = await this.getProfile(input.userId);
      if (!current) {
        throw new ProfileNotFoundError();
      }
      throw new StaleVersionError(input.baseVersion, current.version);
    }

    return toProfileRecord(rows[0]);
  }

  async listVersions(userId: string): Promise<ProfileVersionRecord[]> {
    const { rows } = await this.sql.query<VersionRow>(
      `SELECT v.profile_id, v.version, v.markdown, v.source, v.created_at
       FROM youmd_profile_versions v
       JOIN youmd_profiles p ON p.id = v.profile_id
       WHERE p.user_id = $1
       ORDER BY v.version DESC`,
      [userId]
    );

    return rows.map((row) => ({
      profileId: row.profile_id,
      version: Number(row.version),
      markdown: row.markdown,
      source: row.source as ProfileSource,
      createdAt: toIso(row.created_at),
    }));
  }

  async deleteProfile(userId: string): Promise<boolean> {
    const { rows } = await this.sql.query<{ id: string }>(
      `DELETE FROM youmd_profiles WHERE user_id = $1 RETURNING id`,
      [userId]
    );
    return rows.length > 0;
  }
}
