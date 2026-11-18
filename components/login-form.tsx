"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A Client Component only to show the pending state and the error returned
 * by the `login` Server Action. The form itself posts straight to the server.
 */
export default function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="font-heading text-2xl font-medium text-navy">Sign in</h1>

      <label className="grid gap-1.5 text-sm font-medium text-navy">
        Email
        <Input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-navy">
        Password
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-destructive/15 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Accounts are created by your team leader.
      </p>
    </form>
  );
}
