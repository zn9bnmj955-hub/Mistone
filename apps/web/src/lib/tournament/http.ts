import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffActor, type StaffActor } from "./staff";

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * The visitor's address as reported by the hosting platform, or null. Only
 * headers set by the platform are trusted (the left-most X-Forwarded-For value
 * is chosen by the client): Netlify's client IP header, then the proxy's own
 * header, then the last hop appended by the proxy. Use it where the real
 * address is needed (Turnstile); rate limits use `clientIp`.
 */
export function clientAddress(request: Pick<NextRequest, "headers">): string | null {
  const h = request.headers;
  const platform = h.get("x-nf-client-connection-ip") ?? h.get("x-real-ip");
  if (platform?.trim()) return platform.trim();
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? null;
}

/**
 * The visitor's key for rate limits. An IPv6 visitor usually owns a whole /64
 * (a home box hands out billions of addresses), so limits apply to the /64
 * prefix, never to the full address. IPv4 (including IPv4-mapped IPv6) is kept
 * as is. No header: "local" (development). Unreadable address: one shared
 * "unknown" key (logged), so that garbage can never dodge the limits.
 */
export function clientIp(request: Pick<NextRequest, "headers">): string {
  const raw = clientAddress(request);
  if (raw === null) return "local";
  const key = ipRateLimitKey(raw);
  if (key === null) {
    console.warn("[rate-limit] unreadable client address, shared key used");
    return "unknown";
  }
  return key;
}

/** Rate-limit key of an address: IPv4 as dotted quad, IPv6 as its /64 prefix ("2001:db8:0:1::/64"); null when unreadable. */
export function ipRateLimitKey(raw: string): string | null {
  let a = raw.trim();
  // "[v6]:port" or "[v6]"
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (bracket) a = bracket[1]!;
  // "1.2.3.4:port"
  const v4port = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(a);
  if (v4port) a = v4port[1]!;
  const v4 = parseIpv4(a);
  if (v4) return v4.join(".");
  const groups = parseIpv6(a);
  if (!groups) return null;
  // IPv4-mapped (::ffff:a.b.c.d): an IPv4 visitor.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

function parseIpv4(a: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return null;
  const parts = a.split(".").map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

/** The 8 groups of an IPv6 address (compressed "::", zone "%eth0", trailing IPv4 accepted), or null. */
function parseIpv6(input: string): number[] | null {
  let a = input.toLowerCase();
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  if (!a.includes(":") || a.split("::").length > 2) return null;
  const parseSide = (side: string, allowV4: boolean): number[] | null => {
    if (side === "") return [];
    const out: number[] = [];
    const parts = side.split(":");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (allowV4 && i === parts.length - 1 && p.includes(".")) {
        const v4 = parseIpv4(p);
        if (!v4) return null;
        out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else if (/^[0-9a-f]{1,4}$/.test(p)) {
        out.push(parseInt(p, 16));
      } else return null;
    }
    return out;
  };
  const halves = a.split("::");
  if (halves.length === 2) {
    const head = parseSide(halves[0]!, false);
    const tail = parseSide(halves[1]!, true);
    if (!head || !tail || head.length + tail.length > 7) return null;
    return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  }
  const all = parseSide(a, true);
  return all && all.length === 8 ? all : null;
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

/** Gives back one hit counted by rateLimit (e.g. a PIN attempt that turned out right). */
export async function refundRateLimit(key: string): Promise<void> {
  await createAdminClient().rpc("refund_rate_limit", { p_key: key });
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
