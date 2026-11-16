import { after, NextResponse, type NextRequest } from "next/server";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { getMessages } from "@/i18n";
import { processDueDraws } from "@/lib/tournament/auto-draw";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTournament } from "@/lib/tournament/load";
import { createVersionedCache } from "@/lib/tournament/versioned-cache";
import { escapeHtml } from "@/terrain/html";
import { myTeamCookie } from "@/terrain/cookies";
import { terrainCacheHeaders } from "@/terrain/cache-headers";
import { renderPurgedPage, renderTerrainPage, VIEWS, type TerrainView } from "@/terrain/render";
import { TERRAIN_CSS } from "@/terrain/styles.generated";

type Ctx = { params: Promise<{ code: string }> };

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/** One light query (state_version) per request; the full state is rebuilt once per version. */
const loadPublic = createVersionedCache({
  readVersion: async (code) => {
    const { data, error } = await createAdminClient().from("tournaments").select("state_version").eq("short_code", code).neq("status", "draft").maybeSingle();
    if (error) throw error;
    return data?.state_version ?? null;
  },
  load: (code) => loadTournament(code),
});

function notFound(code: string): Response {
  const m = getMessages().findDraw;
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrgaSport</title><style>${TERRAIN_CSS}</style></head><body><div class="wrap"><a class="brand" href="/">Orga<b>Sport</b></a><h1>${escapeHtml(m.title)}</h1><p class="msg err">${escapeHtml(m.notFound.replace("{code}", code))}</p><p><a class="btn" href="/tirage">${escapeHtml(m.submit)}</a></p></div></body></html>`;
  return new Response(body, { status: 404, headers: HTML_HEADERS });
}

/**
 * Public tournament page: plain server-rendered HTML, readable without
 * JavaScript, a few kilobytes, no account needed.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { code: raw } = await params;
  const code = normalizeShortCode(raw);
  if (!isShortCode(code)) return notFound(raw.slice(0, 12));
  if (code !== raw) return NextResponse.redirect(new URL(`/c/${code}${request.nextUrl.search}`, request.nextUrl.origin), 301);

  const sp = request.nextUrl.searchParams;
  // "C'est mon équipe": remember the team on this device (cookie, no account).
  const moi = sp.get("moi");
  if (moi !== null) {
    const url = new URL(`/c/${code}`, request.nextUrl.origin);
    const n = Number(moi);
    if (Number.isInteger(n) && n > 0) url.searchParams.set("equipe", String(n));
    const res = NextResponse.redirect(url, 303);
    if (Number.isInteger(n) && n > 0) res.cookies.set(myTeamCookie(code), String(n), { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
    else {
      res.cookies.delete({ name: myTeamCookie(code), path: "/" });
      res.cookies.delete({ name: myTeamCookie(code), path: `/c/${code}` });
    }
    return res;
  }

  const loaded = await loadPublic(code);
  if (!loaded) return notFound(code);
  // 14 days after the final the personal data is purged: the code stays, the results are gone.
  if (loaded.meta.purged_at) return new Response(renderPurgedPage(loaded.meta, { fragment: sp.has("fragment") }), { headers: HTML_HEADERS });

  const view = (VIEWS as string[]).includes(sp.get("vue") ?? "") ? (sp.get("vue") as TerrainView) : "tirage";
  const mineCookie = request.cookies.get(myTeamCookie(code))?.value;
  const mineRaw = Number(mineCookie);
  const msgKey = sp.get("msg");
  const captain = getMessages().terrain.captain as Record<string, string>;
  const ERRORS = new Set(["badCode", "invalid", "notPlayable", "limited", "teamLocked", "ended", "closed"]);
  const message = msgKey && captain[msgKey] ? `${ERRORS.has(msgKey) ? "!" : ""}${captain[msgKey]}` : null;

  // « Enregistrer pour hors ligne »: the same page as a self-contained file (no script, CSS inlined).
  const saved = sp.has("enregistrer") && !sp.has("fragment");
  const body = renderTerrainPage(
    {
      meta: loaded.meta,
      sport: loaded.sport,
      state: loaded.state,
      version: loaded.version,
      view,
      query: sp.get("equipe")?.slice(0, 60) || null,
      mine: Number.isInteger(mineRaw) && mineRaw > 0 ? mineRaw : null,
      message,
      now: new Date(),
    },
    { fragment: sp.has("fragment"), standalone: saved, origin: request.nextUrl.origin },
  );

  // Safety net for automatic draws if the scheduler is late.
  const autoAt = loaded.state.tournament.config.autoDrawAt;
  if (autoAt && Date.parse(autoAt) <= Date.now() && Object.keys(loaded.state.rounds).length === 0) {
    after(() => processDueDraws(code));
  }
  if (saved) {
    const file = `orgasport-${code}${view === "tirage" ? "" : `-${view}`}.html`;
    return new Response(body, { headers: { ...HTML_HEADERS, "content-disposition": `attachment; filename="${file}"` } });
  }
  // Live refreshes (?fragment=1) without a team cookie are shared a few seconds at the CDN, keyed on that cookie.
  const headers = { ...HTML_HEADERS, ...terrainCacheHeaders({ code, fragment: sp.has("fragment"), mine: Boolean(mineCookie), message: Boolean(msgKey) }) };
  return new Response(body, { headers });
}
