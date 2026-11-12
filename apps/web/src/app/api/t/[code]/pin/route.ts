import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, findTournamentRow, json, rateLimit, refundRateLimit } from "@/lib/tournament/http";
import { pinCookieName, signPinSession } from "@/lib/tournament/staff";

type Ctx = { params: Promise<{ code: string }> };
const WINDOW = 900;
const DEVICE_ATTEMPTS = 8;
const FAILURE_COST_UNDER_ATTACK = 3;
const TOURNAMENT_FAILURES = 60;
const schema = z.object({ pin: z.string().regex(/^[0-9]{4,8}$/) });

/** Volunteers without an account open the scoring table with a PIN. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const t = await findTournamentRow(code);
  if (!t || !t.short_code) return json({ error: { code: "NOT_FOUND" } }, 404);
  // Closed for good or purged: no more PIN sessions (not counted as a failed attempt).
  if (t.status === "archived" || t.purged_at) return json({ error: { code: "TOURNAMENT_ARCHIVED" } }, 403);
  const ip = clientIp(request);
  // Brute-force protection, every 15 minutes (only failed attempts count):
  // - per device: 8 attempts. Each attempt is reserved atomically BEFORE the
  //   check (parallel requests never get more than 8 guesses) and given back
  //   when the PIN is right.
  // - per tournament: beyond 60 failures from all devices, the tournament is
  //   under attack and every new failure costs the guilty device 3 attempts
  //   (about 3 guesses instead of 8). A right PIN is never refused because of
  //   other devices: a volunteer is only ever limited by their own mistakes.
  const deviceKey = `pinfail:${t.id}:${ip}`;
  const tournamentKey = `pinfail:${t.id}`;
  if (!(await rateLimit(deviceKey, DEVICE_ATTEMPTS, WINDOW))) return json({ error: { code: "RATE_LIMITED" } }, 429);
  const body = schema.safeParse(await request.json().catch(() => null));
  const { data: staffId } = body.success ? await createAdminClient().rpc("verify_staff_pin", { p_tournament: t.id, p_pin: body.data.pin }) : { data: null };
  if (!staffId) {
    const underAttack = !(await rateLimit(tournamentKey, TOURNAMENT_FAILURES, WINDOW));
    for (let i = 1; underAttack && i < FAILURE_COST_UNDER_ATTACK; i++) await rateLimit(deviceKey, DEVICE_ATTEMPTS, WINDOW);
    return json({ error: { code: "INVALID_PIN" } }, 401);
  }
  await refundRateLimit(deviceKey);
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
