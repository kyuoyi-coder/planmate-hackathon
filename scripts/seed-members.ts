/**
 * Adds 13 example team members so the app has people to sign in as and assign
 * tasks to. Safe to run more than once: existing emails are updated, not duplicated.
 *
 *   npm run db:seed
 *
 * Every example account uses the password below. It is for local demos only;
 * replace these accounts (npm run user:add) before real people use the app.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../lib/db/schema";
import { hashPassword } from "../lib/password";
import { ROLE_LABEL, type Role } from "../lib/roles";

loadEnvConfig(process.cwd());

const DEMO_PASSWORD = "planmate-demo";

const MEMBERS: { name: string; email: string; role: Role }[] = [
  { name: "Ava Chen", email: "ava.chen@example.com", role: "leader" },
  { name: "Noah Williams", email: "noah.williams@example.com", role: "sub-leader" },
  { name: "Maya Rodriguez", email: "maya.rodriguez@example.com", role: "sub-leader" },
  { name: "Liam O'Connor", email: "liam.oconnor@example.com", role: "sub-leader" },
  { name: "Priya Patel", email: "priya.patel@example.com", role: "member" },
  { name: "Devin Park", email: "devin.park@example.com", role: "member" },
  { name: "Zoe Carter", email: "zoe.carter@example.com", role: "member" },
  { name: "Ethan Nguyen", email: "ethan.nguyen@example.com", role: "member" },
  { name: "Sofia Rossi", email: "sofia.rossi@example.com", role: "member" },
  { name: "Kenji Tanaka", email: "kenji.tanaka@example.com", role: "member" },
  { name: "Amara Okafor", email: "amara.okafor@example.com", role: "member" },
  { name: "Lucas Meyer", email: "lucas.meyer@example.com", role: "member" },
  { name: "Hana Kim", email: "hana.kim@example.com", role: "member" },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    for (const member of MEMBERS) {
      const passwordHash = await hashPassword(DEMO_PASSWORD);
      await db
        .insert(users)
        .values({ id: randomUUID(), ...member, passwordHash })
        .onConflictDoUpdate({
          target: users.email,
          set: { name: member.name, role: member.role, passwordHash },
        });
      console.log(`${ROLE_LABEL[member.role].padEnd(12)} ${member.name} <${member.email}>`);
    }
    console.log(`\nSaved ${MEMBERS.length} members. Password for all of them: ${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
