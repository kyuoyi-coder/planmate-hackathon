import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Sign in · PlanMate" };

export default function LoginPage() {
  return (
    <>
      {/* Renders nothing; it only sends an already signed-in user to the app. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <LoginForm />
    </>
  );
}

async function RedirectIfSignedIn() {
  if (await getCurrentUser()) redirect("/");
  return null;
}
