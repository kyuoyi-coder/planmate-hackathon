import { z } from "zod";

/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The outcome of a Server Action, in a form the client can render. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Turns any thrown error into a message that is safe to show. */
export function toUserMessage(error: unknown) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid request.";
  }

  console.error(error);
  const source = ((error as { cause?: unknown } | null)?.cause ?? error) as {
    code?: string;
    message?: string;
  } | null;
  // Connection refused, bad password, missing database, missing table or
  // column, or no password configured at all.
  if (
    ["ECONNREFUSED", "28P01", "3D000", "42P01", "42703"].includes(
      source?.code ?? "",
    ) ||
    /SASL|password must be a string/.test(source?.message ?? "")
  ) {
    return "The database isn't ready. Check DATABASE_URL in .env.local and run `npm run db:migrate`.";
  }
  return "Something went wrong on the server.";
}
