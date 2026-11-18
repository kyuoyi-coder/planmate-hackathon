import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { planmatePool?: Pool };

// The pool connects lazily on the first query, so a missing or wrong
// DATABASE_URL (see .env.example) surfaces as an API error, not a crash at import.
function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// Reuse one pool across hot reloads in development.
const pool = globalForDb.planmatePool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.planmatePool = pool;

export const db = drizzle(pool, { schema });
export { schema };
