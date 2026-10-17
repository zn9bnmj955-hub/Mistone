import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffActor, type StaffActor } from "./staff";

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * The visitor's IP for rate limits. Only headers set by the hosting platform
 * are trusted (the left-most X-Forwarded-For value is chosen by the client):
 * Netlify's client IP header, then the proxy's own header, then the last hop
 * appended by the proxy.
 */
export function clientIp(request: Pick<NextRequest, "headers">): string {
  const h = request.headers;
  const platform = h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip");
  if (platform?.trim()) return platform.trim();
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "local";
}

/** Counts one hit; false when the limit is reached. A database error counts as "limited" (fail closed). */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("hit_rate_limit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) return false;
  return data !== false;
}

/** True when the limit is already reached (does not count this call). */
export async function rateLimited(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { data } = await createAdminClient().rpc("rate_limit_exceeded", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  return data === true;
}

export async function findTournamentRow(rawCode: string) {
  const code = normalizeShortCode(rawCode);
  if (!isShortCode(code)) return null;
  const { data } = await createAdminClient().from("tournaments").select("id, short_code, status, purged_at").eq("short_code", code).neq("status", "draft").maybeSingle();
  return data;
}

/** Resolves the tournament and the staff member, or an error response. */
export async function requireStaff(rawCode: string): Promise<
  { ok: true; tournament: { id: string; short_code: string; status: string }; actor: StaffActor } | { ok: false; response: NextResponse }
> {
  const t = await findTournamentRow(rawCode);
  if (!t || !t.short_code) return { ok: false, response: json({ error: { code: "NOT_FOUND" } }, 404) };
  const actor = await getStaffActor(t);
  if (!actor) return { ok: false, response: json({ error: { code: "UNAUTHORIZED" } }, 401) };
  return { ok: true, tournament: { id: t.id, short_code: t.short_code, status: t.status }, actor };
}
