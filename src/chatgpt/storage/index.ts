import { MemoryProfileStore } from "./memory.js";
import { PostgresProfileStore, type SqlClient } from "./postgres.js";
import type { ProfileStore } from "./types.js";

export { MemoryProfileStore } from "./memory.js";
export { PostgresProfileStore } from "./postgres.js";
export type { SqlClient } from "./postgres.js";
export type {
  CreateProfileInput,
  ProfileRecord,
  ProfileSource,
  ProfileStore,
  ProfileVersionRecord,
  UpdateProfileInput,
} from "./types.js";

/**
 * Pick a store from the environment.
 *
 * `DATABASE_URL` selects Postgres, which needs the `pg` driver installed in the
 * deployment. Without it you get the in-memory store, which is fine for local
 * prototyping and loses everything on restart.
 */
export async function createStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<ProfileStore> {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    return new MemoryProfileStore();
  }

  // Resolved at runtime so `pg` stays an optional dependency of the deployment
  // rather than something this package has to declare and ship.
  const driver = "pg";
  let pg: { Pool: new (config: Record<string, unknown>) => SqlClient };
  try {
    pg = (await import(driver)) as unknown as typeof pg;
  } catch {
    throw new Error(
      "DATABASE_URL is set but the 'pg' driver is not installed. Run `npm install pg` in the deployment, or unset DATABASE_URL to use the in-memory store."
    );
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  return new PostgresProfileStore(pool);
}
