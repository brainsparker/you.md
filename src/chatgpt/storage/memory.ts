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
  ProfileVersionRecord,
  UpdateProfileInput,
} from "./types.js";

/**
 * In-process store. Used for tests and for local prototyping before a database
 * is wired up; everything is lost when the process exits.
 */
export class MemoryProfileStore implements ProfileStore {
  private readonly users = new Map<string, string>();
  private readonly profilesByUser = new Map<string, ProfileRecord>();
  private readonly versionsByProfile = new Map<string, ProfileVersionRecord[]>();

  async resolveUserId(provider: string, providerUserId: string): Promise<string> {
    const key = `${provider}:${providerUserId}`;
    let userId = this.users.get(key);
    if (!userId) {
      userId = `usr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      this.users.set(key, userId);
    }
    return userId;
  }

  async getProfile(userId: string): Promise<ProfileRecord | null> {
    return this.profilesByUser.get(userId) ?? null;
  }

  async createProfile(input: CreateProfileInput): Promise<ProfileRecord> {
    const existing = this.profilesByUser.get(input.userId);
    if (existing) {
      throw new ProfileExistsError(existing.profileId, existing.version);
    }

    const now = new Date().toISOString();
    const record: ProfileRecord = {
      profileId: `prof_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      userId: input.userId,
      version: 1,
      markdown: input.markdown,
      structured: input.structured ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.profilesByUser.set(input.userId, record);
    this.versionsByProfile.set(record.profileId, [
      {
        profileId: record.profileId,
        version: 1,
        markdown: record.markdown,
        source: input.source ?? "chatgpt",
        createdAt: now,
      },
    ]);

    return record;
  }

  async updateProfile(input: UpdateProfileInput): Promise<ProfileRecord> {
    const current = this.profilesByUser.get(input.userId);
    if (!current) {
      throw new ProfileNotFoundError();
    }
    if (input.baseVersion !== current.version) {
      throw new StaleVersionError(input.baseVersion, current.version);
    }

    const now = new Date().toISOString();
    const updated: ProfileRecord = {
      ...current,
      version: current.version + 1,
      markdown: input.markdown,
      structured: input.structured ?? current.structured,
      updatedAt: now,
    };

    this.profilesByUser.set(input.userId, updated);
    const versions = this.versionsByProfile.get(current.profileId) ?? [];
    versions.push({
      profileId: current.profileId,
      version: updated.version,
      markdown: updated.markdown,
      source: input.source ?? "chatgpt",
      createdAt: now,
    });
    this.versionsByProfile.set(current.profileId, versions);

    return updated;
  }

  async listVersions(userId: string): Promise<ProfileVersionRecord[]> {
    const profile = this.profilesByUser.get(userId);
    if (!profile) {
      return [];
    }
    const versions = this.versionsByProfile.get(profile.profileId) ?? [];
    return [...versions].sort((a, b) => b.version - a.version);
  }

  async deleteProfile(userId: string): Promise<boolean> {
    const profile = this.profilesByUser.get(userId);
    if (!profile) {
      return false;
    }
    this.profilesByUser.delete(userId);
    this.versionsByProfile.delete(profile.profileId);
    return true;
  }
}
