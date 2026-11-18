/**
 * Adds a user to the database, or updates one that already exists.
 * PlanMate has no sign-up page: this is how accounts are created.
 *
 *   npm run user:add -- --name "Ava Chen" --email ava@example.com --password "s3cret-pass" --role leader
 *
 * Roles: leader | sub-leader | member (default: member).
 * Re-running with an existing email updates that user's name, role and password.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { users } from "../lib/db/schema";
import { hashPassword } from "../lib/password";
import { ROLES, type Role } from "../lib/roles";

loadEnvConfig(process.cwd());

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(
    'Usage: npm run user:add -- --name "Full Name" --email you@example.com --password "at-least-8-chars" [--role leader|sub-leader|member]',
  );
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      role: { type: "string", default: "member" },
    },
  });

  const name = values.name?.trim();
  const email = values.email?.trim().toLowerCase();
  const password = values.password ?? "";
  const role = values.role as Role;

  if (!name) fail("--name is required.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("--email must be a valid email address.");
  }
  if (password.length < 8) fail("--password must be at least 8 characters.");
  if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(", ")}.`);
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const passwordHash = await hashPassword(password);
    const [user] = await drizzle(pool)
      .insert(users)
      .values({ id: randomUUID(), name, email, passwordHash, role })
      .onConflictDoUpdate({
        target: users.email,
        set: { name, passwordHash, role },
      })
      .returning({ id: users.id, createdAt: users.createdAt });
    console.log(`Saved ${name} <${email}> as ${role} (id ${user.id}).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
