import { isOfficeBye, pausedAt, type Bracket, type Change, type EngineState, type Match, type Round, type Team } from "@orgasport/engine";

/**
 * What deserves a notification, read from the changes the draw engine just
 * made. Pure: the same changes always give the same events (and the same
 * deduplication keys, so a retried action never notifies twice).
 */
export type NotifyEvent =
  | { kind: "your_turn"; key: string; matchId: string; teamIds: string[] }
  | { kind: "draw_published"; key: string; roundId: string; teamIds: string[] }
  | { kind: "score_validated"; key: string; matchId: string; teamIds: string[] }
  /** Team qualified « d'office » for the next round (one-sided match after the cadrage). */
  | { kind: "office"; key: string; matchId: string; teamIds: string[] }
  /** Team entered the B or the C on its own (« opt_in »). */
  | { kind: "bracket_entry"; key: string; bracket: Exclude<Bracket, "main">; teamIds: string[] }
  /** Two-day tournament: the chain stopped for the night (« Reprise demain »). */
  | { kind: "paused"; key: string; teamIds: string[] };

const DONE = new Set(["done", "forfeit"]);

const teamsOf = (m: Match) => [...m.sideA, ...m.sideB];
const sidesKey = (m: Pick<Match, "sideA" | "sideB">) => `${m.sideA.join("+")}/${m.sideB.join("+")}`;

/**
 * « À vous » once per match, venue and opponents. A match that is only
 * placed again (same venue, same teams: reopened, flag cleared, start
 * undone, queue order or time changed, or reopened after its result) notifies
 * nobody; a move of a match not played yet to another venue, or a new
 * opponent, does.
 */
function calledAgain(m: Match, before: Partial<Match> | null): boolean {
  // An update carries only the fields it changed.
  if (!before) return true;
  // Reopened (result removed, teams already played it): a correction, even if
  // the engine had to put it on another venue (its own was taken meanwhile,
  // e.g. during the night of a two-day tournament).
  if ("status" in before && DONE.has(before.status ?? "")) return false;
  if ("venueId" in before && before.venueId !== m.venueId) return true;
  if (!("sideA" in before) && !("sideB" in before)) return false;
  return sidesKey({ sideA: before.sideA ?? m.sideA, sideB: before.sideB ?? m.sideB }) !== sidesKey(m);
}

export function eventsFromChanges(changes: Change[], after: EngineState): NotifyEvent[] {
  const out: NotifyEvent[] = [];
  const seen = new Set<string>();
  const push = (e: NotifyEvent) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    out.push(e);
  };
  let mainRoundOver = false;
  for (const c of changes) {
    if (c.entity === "match" && c.op !== "delete") {
      const m = after.matches[c.id] ?? (c.after as unknown as Match);
      const before = c.op === "update" ? (c.before as unknown as Partial<Match>) : null;
      // Ready = opponent known and venue assigned.
      if (m.status === "ready" && m.venueId && m.sideA.length && m.sideB.length && calledAgain(m, before)) {
        push({ kind: "your_turn", key: `your_turn:${m.id}:${m.venueId}:${sidesKey(m)}`, matchId: m.id, teamIds: teamsOf(m) });
      }
      if (DONE.has(m.status) && m.scoreA !== null && m.scoreB !== null && before && !DONE.has(before.status ?? "")) {
        push({ kind: "score_validated", key: `score:${m.id}:${m.scoreA}-${m.scoreB}`, matchId: m.id, teamIds: teamsOf(m) });
      }
      if (c.op === "create" && m.sideA.length && isOfficeBye(after, m)) {
        push({ kind: "office", key: `office:${m.id}:${m.sideA.join("+")}`, matchId: m.id, teamIds: [...m.sideA] });
      }
    }
    if (c.entity === "round" && c.op !== "delete") {
      const r = after.rounds[c.id] ?? (c.after as unknown as Round);
      const before = c.op === "update" ? (c.before as unknown as Partial<Round>) : null;
      if (r.bracket === "main" && c.op === "update" && c.after.status === "finished") mainRoundOver = true;
      // An update carries only the fields it changed: a status change is not a new draw.
      if (r.drawnAt && (!before || ("drawnAt" in before && !before.drawnAt))) {
        // Teams « d'office » get their own message instead.
        const office = new Set(Object.values(after.matches).filter((m) => m.roundId === r.id && isOfficeBye(after, m)).flatMap(teamsOf));
        const teamIds = Object.values(after.matches)
          .filter((m) => m.roundId === r.id)
          .flatMap(teamsOf)
          .filter((id) => !office.has(id));
        if (teamIds.length) push({ kind: "draw_published", key: `draw:${r.id}:${r.seed ?? ""}`, roundId: r.id, teamIds: [...new Set(teamIds)] });
      }
    }
    if (c.entity === "team" && c.op === "update" && "entries" in c.after) {
      const t = after.teams[c.id];
      const was = new Set((c.before as Partial<Team> | undefined)?.entries ?? []);
      for (const bracket of t?.entries ?? []) {
        if (bracket !== "main" && !was.has(bracket)) push({ kind: "bracket_entry", key: `entry:${t!.id}:${bracket}`, bracket, teamIds: [t!.id] });
      }
    }
  }
  // Announced when the round of the A that reaches the pause is over (not on
  // corrections during the night, nor while the B and the C finish). Its key
  // names the held round.
  const pause = mainRoundOver ? pausedAt(after) : null;
  if (pause) {
    const teamIds = Object.values(after.teams)
      .filter((t) => t.status === "checked_in" || t.status === "registered")
      .map((t) => t.id);
    if (teamIds.length) push({ kind: "paused", key: `pause:${pause.phase}:${pause.round}`, teamIds });
  }
  return out;
}
