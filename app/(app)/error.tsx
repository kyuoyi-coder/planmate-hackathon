"use client";

import { Button } from "@/components/ui/button";

/** Shown in place of a page whose server data failed to load. */
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-navy">This page couldn&apos;t load</h1>
      <p className="text-muted-foreground">
        The server couldn&apos;t read your data. Check that the database is
        running and that <code>DATABASE_URL</code> in <code>.env.local</code>{" "}
        is correct, then try again.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
