import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, findTournamentRow, json, rateLimit, rateLimited } from "@/lib/tournament/http";
import { pinCookieName, signPinSession } from "@/lib/tournament/staff";

type Ctx = { params: Promise<{ code: string }> };
const schema = z.object({ pin: z.string().regex(/^[0-9]{4,8}$/) });

/** Volunteers without an account open the scoring table with a PIN. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const t = await findTournamentRow(code);
  if (!t || !t.short_code) return json({ error: { code: "NOT_FOUND" } }, 404);
  // Closed for good or purged: no more PIN sessions (not counted as a failed attempt).
  if (t.status === "archived" || t.purged_at) return json({ error: { code: "TOURNAMENT_ARCHIVED" } }, 403);
  const ip = clientIp(request);
  // Brute-force protection: 8 wrong PINs per device and 60 per tournament
  // every 15 minutes. Successful logins are not counted.
  const deviceKey = `pinfail:${t.id}:${ip}`;
  const tournamentKey = `pinfail:${t.id}`;
  if ((await rateLimited(deviceKey, 8, 900)) || (await rateLimited(tournamentKey, 60, 900))) return json({ error: { code: "RATE_LIMITED" } }, 429);
  const body = schema.safeParse(await request.json().catch(() => null));
  const { data: staffId } = body.success ? await createAdminClient().rpc("verify_staff_pin", { p_tournament: t.id, p_pin: body.data.pin }) : { data: null };
  if (!staffId) {
    await rateLimit(deviceKey, 8, 900);
    await rateLimit(tournamentKey, 60, 900);
    return json({ error: { code: "INVALID_PIN" } }, 401);
  }
  const session = await signPinSession(t.id, staffId);
  const res = json({ ok: true });
  res.cookies.set(pinCookieName(t.short_code), session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const t = await findTournamentRow(code);
  const res = json({ ok: true });
  if (t?.short_code) res.cookies.delete(pinCookieName(t.short_code));
  return res;
}
