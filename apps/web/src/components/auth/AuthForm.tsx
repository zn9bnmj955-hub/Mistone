"use client";
import { useCallback, useState } from "react";
import { Icon } from "@orgasport/ui";
import { getBrowserClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";
import { safeInternalPath } from "@/lib/safe-path";
import { fmt, getMessages } from "@/i18n";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Turnstile } from "./Turnstile";

type Mode = "signin" | "signup";

function errorMessage(err: { message?: string; code?: string; status?: number }) {
  const m = getMessages().auth;
  const code = err.code ?? "";
  if (code === "invalid_credentials") return m.invalidCredentials;
  if (code === "weak_password") return m.weakPassword;
  if (code === "user_already_exists" || code === "email_exists") return m.emailTaken;
  if (err.status === 429 || code.includes("rate_limit")) return m.rateLimited;
  return getMessages().common.error;
}

/**
 * Email (magic link or password), Google and Apple. `next` is where to go
 * once signed in; `onSignedIn` lets the onboarding continue in place when the
 * session is created immediately (password).
 */
export function AuthForm({
  initialMode = "signin",
  next = "/accueil",
  onSignedIn,
}: {
  initialMode?: Mode;
  next?: string;
  onSignedIn?: () => void;
}) {
  const m = getMessages().auth;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [usePassword, setUsePassword] = useState(initialMode === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const onToken = useCallback((t: string) => setCaptchaToken(t), []);

  const target = () => safeInternalPath(next, window.location.origin);
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(target())}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const supabase = getBrowserClient();
    try {
      if (!usePassword) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo(), shouldCreateUser: true, captchaToken },
        });
        if (error) throw error;
        setInfo(fmt(m.magicLinkSent, { email }));
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
        if (error) throw error;
        done();
      } else {
        if (password.length < 8) throw { code: "weak_password" };
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo(), captchaToken },
        });
        if (error) throw error;
        if (data.session) done();
        else setInfo(m.confirmEmail);
      }
    } catch (err) {
      setError(errorMessage(err as { code?: string }));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    if (onSignedIn) onSignedIn();
    else window.location.assign(target());
  }

  async function oauth(provider: "google" | "apple") {
    setError(null);
    const { error } = await getBrowserClient().auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    if (error) setError(errorMessage(error));
  }

  return (
    <div className="grid gap-5">
      {env.authProviders.length > 0 && (
        <>
          <div className="grid gap-2">
            {env.authProviders.map((p) => (
              <Button key={p} variant="outline" onClick={() => oauth(p)}>
                {p === "google" ? m.google : m.apple}
              </Button>
            ))}
          </div>
          <p className="flex items-center gap-3 text-sm font-bold text-ink-soft before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            {m.or}
          </p>
        </>
      )}
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <TextField
          id="auth-email"
          label={m.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={m.emailPlaceholder}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {usePassword && (
          <TextField
            id="auth-password"
            label={m.password}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            hint={mode === "signup" ? m.passwordHint : undefined}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <Turnstile onToken={onToken} />
        {error && (
          <p role="alert" className="rounded-[var(--radius)] bg-danger/10 px-4 py-3 text-sm font-bold text-danger">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="flex items-start gap-2 rounded-[var(--radius)] bg-success/10 px-4 py-3 text-sm font-bold text-success">
            <Icon name="mail" size={20} className="mt-0.5 shrink-0" />
            {info}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy || !email}>
          {!usePassword ? m.magicLink : mode === "signin" ? m.signIn : m.signUp}
        </Button>
        <button type="button" onClick={() => setUsePassword((v) => !v)} className="min-h-12 text-sm font-bold text-accent-ink underline-offset-4 hover:underline">
          {usePassword ? m.withMagic : m.withPassword}
        </button>
      </form>
      <p className="text-center text-sm text-ink-soft">
        {mode === "signin" ? m.noAccount : m.hasAccount}{" "}
        <button
          type="button"
          className="font-bold text-ink underline underline-offset-4"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setUsePassword(true);
            setError(null);
          }}
        >
          {mode === "signin" ? m.createOne : m.loginInstead}
        </button>
      </p>
    </div>
  );
}
