import { NextResponse, type NextRequest } from "next/server";
import { EngineError, resolveScore } from "@orgasport/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeCommand } from "@/lib/tournament/execute";
import { clientIp, rateLimit } from "@/lib/tournament/http";
import { loadTournament } from "@/lib/tournament/load";
import { teamCodeCookie } from "@/terrain/cookies";
import { currentMatch, teamTimeline } from "@/terrain/view-model";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Score entered by a captain from the public page (plain HTML form, works
 * without JavaScript). The score is validated when the opponent's captain
 * enters the same one; otherwise the scoring table decides.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const form = await request.formData();
  const teamNumber = Number(form.get("equipe"));
  const back = (msg: string) => {
    const url = new URL(`/c/${code}`, request.nextUrl.origin);
    if (Number.isInteger(teamNumber) && teamNumber > 0) url.searchParams.set("equipe", String(teamNumber));
    url.searchParams.set("msg", msg);
    url.hash = "mon-equipe";
    return NextResponse.redirect(url, 303);
  };

  const loaded = await loadTournament(code, { secrets: true });
  if (!loaded) return back("notPlayable");
  // Finished: only the scoring table may still correct; closed (archived) or purged: nothing at all.
  const status = loaded.state.tournament.status;
  if (status === "archived" || loaded.meta.purged_at) return back("closed");
  if (status === "finished") return back("ended");
  if (loaded.state.tournament.config.scoreEntry !== "captains") return back("notPlayable");
  if (!(await rateLimit(`captain:${loaded.meta.id}:${clientIp(request)}`, 20, 900))) return back("limited");

  const team = Object.values(loaded.state.teams).find((t) => t.number === teamNumber);
  if (!team) return back("notPlayable");
  const typed = String(form.get("code") ?? "").trim() || request.cookies.get(teamCodeCookie(code, teamNumber))?.value || "";
  const secret = loaded.state.teamSecrets[team.id]?.code;
  if (!secret || typed !== secret) return back("badCode");

  const info = currentMatch(teamTimeline(loaded.state, team.id));
  if (!info || !["ready", "playing", "score_submitted", "disputed"].includes(info.match.status)) return back("notPlayable");
  const us = Number(form.get("us"));
  const them = Number(form.get("them"));
  const scoreA = info.side === "A" ? us : them;
  const scoreB = info.side === "A" ? them : us;
  const knockout = info.round.phase === "elimination" || info.round.phase === "final";
  try {
    resolveScore(loaded.state.rules.scoring, { scoreA, scoreB }, knockout);
  } catch (e) {
    if (e instanceof EngineError && e.code !== "TIEBREAK_REQUIRED") return back("invalid");
  }

  const admin = createAdminClient();
  await admin.from("score_submissions").insert({ match_id: info.match.id, submitted_by_team: team.id, side: info.side, score_a: scoreA, score_b: scoreB });
  const { data: others } = await admin
    .from("score_submissions")
    .select("id, side, score_a, score_b")
    .eq("match_id", info.match.id)
    .eq("status", "pending")
    .neq("side", info.side)
    .order("created_at", { ascending: false })
    .limit(1);
  const other = others?.[0];
  const opId = crypto.randomUUID();
  let msg = "sent";
  if (other && other.score_a === scoreA && other.score_b === scoreB) {
    const res = await executeCommand({ code, command: { type: "match.score", matchId: info.match.id, scoreA, scoreB }, clientOpId: opId, actor: null, source: "captain" });
    if (res.ok) {
      await admin.from("score_submissions").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("match_id", info.match.id).eq("status", "pending");
      msg = "validated";
    } else msg = "invalid";
  } else if (other) {
    await executeCommand({ code, command: { type: "match.setFlag", matchId: info.match.id, flag: "disputed" }, clientOpId: opId, actor: null, source: "captain" });
    await admin.from("score_submissions").update({ status: "disputed" }).eq("match_id", info.match.id).eq("status", "pending");
    msg = "disputed";
  } else {
    await executeCommand({ code, command: { type: "match.setFlag", matchId: info.match.id, flag: "score_submitted" }, clientOpId: opId, actor: null, source: "captain" });
  }
  const res = back(msg);
  res.cookies.set(teamCodeCookie(code, teamNumber), typed, { httpOnly: true, sameSite: "lax", path: `/c/${code}`, maxAge: 60 * 60 * 24 });
  return res;
}
