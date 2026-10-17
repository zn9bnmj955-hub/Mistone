import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { after, NextResponse, type NextRequest } from "next/server";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { getMessages, fmt } from "@/i18n";
import { sendEmail } from "@/lib/email";
import { formatDay, formatTime } from "@/lib/format";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/tournament/http";
import { loadTournament, type LoadedTournament } from "@/lib/tournament/load";
import { registerOnline, registrationWindow, teamShape, validateRegistration, type RegistrationIssue } from "@/lib/tournament/register";
import { turnstileSiteKey, verifyTurnstile } from "@/lib/turnstile";
import { myTeamCookie, registrationCookie as regCookie } from "@/terrain/cookies";
import { escapeHtml } from "@/terrain/html";
import { FIELD, hasTeammates, parseRegistrationForm, renderRegistrationPage, type FormValues } from "@/terrain/registration";
import { TERRAIN_CSS } from "@/terrain/styles.generated";

type Ctx = { params: Promise<{ code: string }> };

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function notFound(code: string): Response {
  const m = getMessages().findDraw;
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrgaSport</title><style>${TERRAIN_CSS}</style></head><body><div class="wrap"><a class="brand" href="/">Orga<b>Sport</b></a><h1>${escapeHtml(getMessages().registration.title)}</h1><p class="msg err">${escapeHtml(m.notFound.replace("{code}", code))}</p><p><a class="btn" href="/tirage">${escapeHtml(m.submit)}</a></p></div></body></html>`;
  return new Response(body, { status: 404, headers: HTML_HEADERS });
}

async function resolve(raw: string): Promise<{ code: string; loaded: LoadedTournament } | Response> {
  const code = normalizeShortCode(raw);
  if (!isShortCode(code)) return notFound(raw.slice(0, 12));
  const loaded = await loadTournament(code);
  if (!loaded) return notFound(code);
  // Purged (B3): personal data deleted for good, shown and refused as a closed link.
  if (loaded.meta.purged_at) return { code, loaded: { ...loaded, meta: { ...loaded.meta, status: "archived" } } };
  return { code, loaded };
}

function activeTeams(loaded: LoadedTournament): number {
  return Object.values(loaded.state.teams).filter((t) => t.status !== "waitlist" && t.status !== "withdrawn").length;
}

function rulesPdfUrl(loaded: LoadedTournament): string | null {
  const path = loaded.meta.rules_pdf_path;
  return path ? createPublicClient().storage.from("tournament-media").getPublicUrl(path).data.publicUrl : null;
}

/** Signed-in person: prefill the captain and the first player. */
async function viewerPrefill(): Promise<{ userId: string | null; values: FormValues; license: string | null }> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) return { userId: null, values: {}, license: null };
    const [{ data: profile }, { data: priv }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
      supabase.from("profiles_private").select("phone, license_number").eq("user_id", userId).maybeSingle(),
    ]);
    const name = (profile?.display_name ?? "").trim();
    const [first, ...rest] = name.split(/\s+/);
    const email = typeof data?.claims?.email === "string" ? data.claims.email : "";
    return {
      userId,
      license: priv?.license_number ?? null,
      values: {
        [FIELD.captainName]: name,
        [FIELD.email]: email,
        [FIELD.phone]: priv?.phone ?? "",
        [FIELD.first(0)]: first ?? "",
        [FIELD.last(0)]: rest.join(" "),
        [FIELD.me]: name ? "on" : "",
      },
    };
  } catch {
    return { userId: null, values: {}, license: null };
  }
}

function page(
  loaded: LoadedTournament,
  opts: { values: FormValues; issues?: RegistrationIssue[]; notice?: string | null; signedIn: boolean },
  status = 200,
): Response {
  const body = renderRegistrationPage({
    meta: loaded.meta,
    sport: loaded.sport,
    shape: teamShape(loaded.meta, loaded.sport),
    window: registrationWindow(loaded.meta, activeTeams(loaded), Date.now()),
    values: opts.values,
    issues: opts.issues ?? [],
    notice: opts.notice ?? null,
    signedIn: opts.signedIn,
    turnstileSiteKey: turnstileSiteKey(),
    rulesPdfUrl: rulesPdfUrl(loaded),
  });
  return new Response(body, { status, headers: HTML_HEADERS });
}

/** Registration form of a tournament (works without JavaScript). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const r = await resolve((await params).code);
  if (r instanceof Response) return r;
  const prefill = await viewerPrefill();
  const shape = teamShape(r.loaded.meta, r.loaded.sport);
  const values = { ...prefill.values };
  if (prefill.license && shape.license !== "hidden") values[FIELD.license(0)] = prefill.license;
  return page(r.loaded, { values, signedIn: Boolean(prefill.userId) });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true; // Old browsers may send neither; the rate limit still applies.
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const r = await resolve((await params).code);
  if (r instanceof Response) return r;
  const { code, loaded } = r;
  const m = getMessages().registration;
  const shape = teamShape(loaded.meta, loaded.sport);

  const form = new URLSearchParams(await request.text());
  const parsed = parseRegistrationForm(form, shape);
  const prefill = await viewerPrefill();
  const signedIn = Boolean(prefill.userId);
  // Finished or closed: refused at once, with the clear message of the page (window "closed").
  if (loaded.meta.status === "finished" || loaded.meta.status === "archived") return page(loaded, { values: parsed.values, signedIn }, 409);

  if (!sameOrigin(request) || parsed.honeypot) {
    return page(loaded, { values: parsed.values, notice: m.window.robot, signedIn }, 400);
  }
  const ip = clientIp(request);
  const [okIp, okTournament] = await Promise.all([rateLimit(`reg:ip:${ip}`, 10, 600), rateLimit(`reg:t:${code}`, 300, 3600)]);
  if (!okIp || !okTournament) return page(loaded, { values: parsed.values, notice: m.window.limited, signedIn }, 429);
  if (!(await verifyTurnstile(parsed.turnstileToken, ip))) {
    return page(loaded, { values: parsed.values, notice: m.window.robot, signedIn }, 400);
  }

  const extra: RegistrationIssue[] = [];
  if (!shape.categories && loaded.meta.category !== "all" && !parsed.certified) extra.push({ path: "certify", code: "rules" });
  if (hasTeammates(shape) && !parsed.teammatesInformed) extra.push({ path: "teammates", code: "rules" });

  const deviceToken = request.cookies.get(regCookie(code))?.value || randomBytes(32).toString("base64url");
  const input = { ...parsed.input, selfIsFirstPlayer: signedIn && parsed.input.selfIsFirstPlayer };
  if (extra.length) {
    // Report every problem at once: run the other checks too.
    return page(loaded, { values: parsed.values, issues: [...validateRegistration(input, shape, loaded.sport), ...extra], signedIn }, 422);
  }

  const result = await registerOnline(code, input, { userId: prefill.userId, deviceToken });
  if (!result.ok) {
    if (result.error === "invalid") return page(loaded, { values: parsed.values, issues: result.issues, signedIn }, 422);
    if (result.error === "busy") return page(loaded, { values: parsed.values, notice: m.window.busy, signedIn }, 503);
    // Window changed in the meantime (closed, full): show the up-to-date page.
    const fresh = await loadTournament(code);
    return page(fresh ?? loaded, { values: parsed.values, signedIn }, 409);
  }

  revalidateTag("tournaments", "max");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const email = input.captain.email;
  if (email) {
    const meta = loaded.meta;
    after(async () => {
      const e = m.email;
      const place = [meta.address, meta.postcode, meta.city].filter(Boolean).join(", ");
      const lines = [
        fmt(e.intro, { name: input.captain.name }),
        "",
        fmt(result.status === "waitlist" ? e.waitlist : e.registered, { number: result.number, tournament: meta.name }),
        fmt(e.when, { date: formatDay(meta.starts_at), time: formatTime(meta.starts_at) }),
        place ? fmt(e.where, { place }) : "",
        meta.checkin_closes_at ? fmt(e.checkIn, { time: formatTime(meta.checkin_closes_at) }) : "",
        "",
        fmt(e.links, { url: `${site}/c/${code}?equipe=${result.number}`, ics: `${site}/c/${code}/calendrier.ics` }),
        "",
        e.outro,
      ].filter((l, i, all) => l !== "" || all[i - 1] !== "");
      try {
        await sendEmail({
          to: email,
          subject: fmt(result.status === "waitlist" ? e.subjectWaitlist : e.subject, { name: meta.name }),
          text: lines.join("\n"),
        });
      } catch (err) {
        console.error("registration email failed", err);
      }
    });
  }

  const res = NextResponse.redirect(new URL(`/c/${code}/inscription/ok?equipe=${result.number}`, request.nextUrl.origin), 303);
  // Path "/" so the tournament details page (/concours/CODE) also knows the team.
  res.cookies.set(myTeamCookie(code), String(result.number), { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  res.cookies.set(regCookie(code), deviceToken, { path: `/c/${code}`, maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return res;
}
