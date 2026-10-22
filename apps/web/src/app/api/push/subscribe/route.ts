import type { NextRequest } from "next/server";
import { z } from "zod";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIp, json, rateLimit } from "@/lib/tournament/http";

/**
 * A browser accepts notifications: we keep its push endpoint and, when given,
 * the team it follows (no account needed). Signed-in people get their
 * account linked so every team they play in reaches this device.
 */
const keys = z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) });
const subscription = z.object({ endpoint: z.url().max(1000).startsWith("https://"), keys });
const body = z.object({
  subscription,
  code: z.string().max(8).optional(),
  team: z.number().int().min(1).max(10000).optional(),
});
const removeBody = z.object({ endpoint: z.url().max(1000), code: z.string().max(8).optional(), team: z.number().int().min(1).max(10000).optional() });

async function viewerId(): Promise<string | null> {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    return data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}

async function resolveTeam(rawCode: string | undefined, team: number | undefined) {
  if (!rawCode) return { tournamentId: null, teamId: null, closed: false };
  const code = normalizeShortCode(rawCode);
  if (!isShortCode(code)) return null;
  const admin = createAdminClient();
  const { data: t } = await admin.from("tournaments").select("id, status, purged_at").eq("short_code", code).neq("status", "draft").maybeSingle();
  if (!t) return null;
  // Closed (archived) or purged: nothing new may follow it — the purge never runs twice.
  const closed = t.status === "archived" || !!t.purged_at;
  if (!team) return { tournamentId: t.id, teamId: null, closed };
  const { data: tm } = await admin.from("teams").select("id").eq("tournament_id", t.id).eq("number", team).maybeSingle();
  return tm ? { tournamentId: t.id, teamId: tm.id, closed } : null;
}

export async function POST(request: NextRequest) {
  if (!(await rateLimit(`push:ip:${clientIp(request)}`, 30, 600))) return json({ error: { code: "RATE_LIMITED" } }, 429);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: { code: "INVALID" } }, 400);
  const { subscription: sub, code, team } = parsed.data;
  const target = await resolveTeam(code, team);
  if (target === null) return json({ error: { code: "NOT_FOUND" } }, 404);
  if (target.closed) return json({ error: { code: "TOURNAMENT_ARCHIVED" } }, 410);
  const userId = await viewerId();
  const admin = createAdminClient();
  const { data: existing } = await admin.from("push_subscriptions").select("id, user_id").eq("endpoint", sub.endpoint).maybeSingle();
  let id = existing?.id;
  if (existing) {
    await admin
      .from("push_subscriptions")
      .update({ p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_id: existing.user_id ?? userId, failed_count: 0 })
      .eq("id", existing.id);
  } else {
    const { data, error } = await admin
      .from("push_subscriptions")
      .insert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_id: userId, user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null })
      .select("id")
      .single();
    if (error) return json({ error: { code: "SERVER" } }, 500);
    id = data.id;
  }
  if (target.tournamentId && id) {
    await admin
      .from("push_targets")
      .upsert({ subscription_id: id, tournament_id: target.tournamentId, team_id: target.teamId }, { onConflict: "subscription_id,tournament_id,team_id", ignoreDuplicates: true });
  }
  if (userId) await admin.from("profiles").update({ notifications_opt_in: true }).eq("id", userId);
  return json({ ok: true });
}

/** Stop notifications for one team, or for this device entirely (knowing the endpoint proves it is yours). */
export async function DELETE(request: NextRequest) {
  const parsed = removeBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: { code: "INVALID" } }, 400);
  const admin = createAdminClient();
  const { data: sub } = await admin.from("push_subscriptions").select("id").eq("endpoint", parsed.data.endpoint).maybeSingle();
  if (!sub) return json({ ok: true });
  const target = await resolveTeam(parsed.data.code, parsed.data.team);
  if (parsed.data.code && target?.tournamentId) {
    let q = admin.from("push_targets").delete().eq("subscription_id", sub.id).eq("tournament_id", target.tournamentId);
    if (target.teamId) q = q.eq("team_id", target.teamId);
    await q;
  } else {
    await admin.from("push_subscriptions").delete().eq("id", sub.id);
  }
  return json({ ok: true });
}
