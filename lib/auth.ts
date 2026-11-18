import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import type { Role } from "@/lib/roles";

export const SESSION_COOKIE = "planmate_session";
/** A sign-in lasts one day; after that the user signs in again. */
const SESSION_DAYS = 1;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  dayStart: number;
  dayEnd: number;
  maxWorkMinutes: number;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db
    .insert(schema.sessions)
    .values({ id: hashToken(token), userId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user for this request, verified against the database, or null.
 * Wrapped in React's cache() so the several components on a page that need the
 * user share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      dayStart: schema.users.dayStart,
      dayEnd: schema.users.dayEnd,
      maxWorkMinutes: schema.users.maxWorkMinutes,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, hashToken(token)),
        // Compared on the database clock, so rendering never reads the time itself.
        gt(schema.sessions.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
});

/** For Server Components: the signed-in user, or a redirect to the login page. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
