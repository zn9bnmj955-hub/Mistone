import type { Metadata } from "next";
import { Suspense } from "react";
import { getMessages } from "@/i18n";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeInternalPath } from "@/lib/safe-path";

export const metadata: Metadata = { title: getMessages().auth.loginTitle };

type Search = Promise<{ mode?: string; next?: string; erreur?: string }>;

async function Content({ searchParams }: { searchParams: Search }) {
  const m = getMessages().auth;
  const { mode, next, erreur } = await searchParams;
  const signup = mode === "signup";
  const safeNext = safeInternalPath(next);
  return (
    <div className="grid gap-6 pt-6">
      <h1 className="display text-5xl">{signup ? m.signupTitle : m.loginTitle}</h1>
      {erreur && (
        <p role="alert" className="rounded-[var(--radius)] bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
          {m.callbackError}
        </p>
      )}
      <AuthForm initialMode={signup ? "signup" : "signin"} next={safeNext} />
    </div>
  );
}

export default function LoginPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
