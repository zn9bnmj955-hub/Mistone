import { compareRounds, isFixedTree, isWalkover, propagateFixed, unpropagateFixed } from "./bracket";
import { EngineError, fail } from "./errors";
import {
  afterResult,
  autoAdvance,
  canDrawNext,
  deleteRound,
  drawNext,
  isBracketEnabled,
  laterMatchesWith,
  pausedAt,
  poolTeams,
  qualificationSnapshot,
  refreshRounds,
  swapInLaterMatches,
  assertNothingDrawnAfter,
  type DrawContext,
  type ExtraBracket,
} from "./formats";
import { ACTIVE_ON_VENUE, affiliationOf, hasResult, isFinished, loserTeams, matchesOfRound, roundsOf, teamAffiliation, teamClubFrom, winnerTeams } from "./queries";
import { hash128 } from "./rng";
import { resolveScore } from "./scoring";
import { Transaction, type Change } from "./tx";
import type { Bracket, EngineContext, PlayerClub, EngineState, Match, Side, TeamStatus, TournamentStatus, Winner } from "./types";
import { autoAssignVenues } from "./venues";

export type PlayerInput = {
  firstName: string;
  lastName: string;
  /** Player's club (public). All players of one club fill `team.club`; two clubs make the team « N.H. ». */
  club?: PlayerClub | null;
};

const playerClub = (c: PlayerClub | null | undefined): PlayerClub | null =>
  c && (c.number.trim() || c.name.trim()) ? { number: c.number.trim(), name: c.name.trim() } : null;

export type Command =
  | {
      type: "team.create";
      name?: string | null;
      club?: string | null;
      players: PlayerInput[];
      checkIn?: boolean;
      source?: "onsite" | "organizer" | "online";
      /** No waiting list: refuse instead of putting the team on it (decided on the latest state). */
      refuseIfFull?: boolean;
    }
  | { type: "team.update"; teamId: string; name?: string | null; club?: string | null; seed?: number | null; players?: PlayerInput[] }
  | { type: "team.setStatus"; teamId: string; status: TeamStatus }
  | { type: "team.lateEntry"; teamId: string }
  /** « opt_in » B or C: the team enters (or leaves) that bracket, before its first draw. */
  | { type: "team.enterBracket"; teamId: string; bracket: ExtraBracket; enter: boolean }
  | { type: "round.draw"; bracket: Bracket; seed: string }
  | { type: "round.redraw"; roundId: string; seed: string }
  | { type: "match.swapTeams"; a: { matchId: string; side: Side }; b: { matchId: string; side: Side } }
  | { type: "match.setVenue"; matchId: string; venueId: string }
  | { type: "match.start"; matchId: string }
  | { type: "match.score"; matchId: string; scoreA: number; scoreB: number; tiebreakA?: number | null; tiebreakB?: number | null }
  | { type: "match.forfeit"; matchId: string; side: Side | "both" }
  | { type: "match.reopen"; matchId: string }
  | { type: "match.setFlag"; matchId: string; flag: "score_submitted" | "disputed" | "clear" }
  | { type: "venue.add"; label: string; reservedForFinals?: boolean }
  | { type: "venue.update"; venueId: string; label?: string; available?: boolean; reservedForFinals?: boolean }
  | { type: "tournament.setStatus"; status: TournamentStatus }
  /** Final, one-way close of the link: finished -> archived. Nothing is accepted afterwards. */
  | { type: "tournament.close" }
  /** Two-day tournament: draws the round held by the pause; the B and the C follow. */
  | { type: "tournament.resume"; seed?: string };

export type CommandType = Command["type"];

export interface CommandResult {
  state: EngineState;
  changes: Change[];
}

const OUT: ReadonlySet<TeamStatus> = new Set(["forfeit", "withdrawn"]);
const PLAYABLE: ReadonlySet<Match["status"]> = new Set(["waiting_venue", "ready", "playing", "score_submitted", "disputed"]);

/**
 * Once finished, only corrections are accepted (scores, forfeits, reopening a
 * match, fixing a team's name) and the final close. Everything else would
 * restart the tournament (new teams, new draws...).
 */
const ALLOWED_WHEN_FINISHED: ReadonlySet<Command["type"]> = new Set([
  "match.score",
  "match.forfeit",
  "match.reopen",
  "team.update",
  "tournament.close",
]);

const STATUS_FLOW: TournamentStatus[] = ["published", "registration_closed", "check_in", "live", "finished", "archived"];

function requireMatch(tx: Transaction, id: string): Match {
  const m = tx.state.matches[id];
  if (!m) fail("NOT_FOUND", { entity: "match" });
  return m;
}

/** Short code given to captains to enter their score (4 digits). */
export function teamScoreCode(teamId: string): string {
  return String(hash128(`score:${teamId}`)[0] % 10000).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface ResultInput {
  winner: Winner;
  scoreA: number | null;
  scoreB: number | null;
  tiebreakA: number | null;
  tiebreakB: number | null;
  status: "done" | "forfeit";
}

function applyResult(tx: Transaction, ctx: EngineContext, matchId: string, r: ResultInput): void {
  const m = requireMatch(tx, matchId);
  if (m.status === "pending" || isWalkover(m) || !m.sideA.length || !m.sideB.length) fail("MATCH_NOT_PLAYABLE", { match: m.position });
  const round = tx.state.rounds[m.roundId]!;
  const wasResult = hasResult(m);
  const winnerChanged = wasResult && m.winner !== r.winner;
  const qualBefore = round.phase === "pool" ? qualificationSnapshot(tx.state) : "";
  const finalDrawn = roundsOf(tx.state, "main", "final").length > 0;

  if (winnerChanged) {
    if (m.winner === null || r.winner === null) assertNothingDrawnAfter(tx.state, m);
    if (isFixedTree(tx.state, round)) unpropagateFixed(tx, m.id, ctx);
    swapInLaterMatches(tx, tx.state.matches[m.id]!, winnerTeams(m), loserTeams(m));
  }
  tx.update("match", m.id, {
    ...r,
    startedAt: m.startedAt ?? m.scheduledAt ?? ctx.now,
    endedAt: wasResult ? m.endedAt : ctx.now,
  });
  if (!wasResult || winnerChanged) afterResult(tx, ctx, m.id);
  if (round.phase === "pool" && wasResult && finalDrawn && qualificationSnapshot(tx.state) !== qualBefore) fail("FINAL_PHASE_DRAWN");
}

function forfeitResult(tx: Transaction, side: Side | "both"): ResultInput {
  const fs = tx.state.tournament.config.forfeitScore;
  if (side === "both") return { winner: null, scoreA: 0, scoreB: 0, tiebreakA: null, tiebreakB: null, status: "forfeit" };
  const winner: Side = side === "A" ? "B" : "A";
  return {
    winner,
    scoreA: winner === "A" ? fs.winner : fs.loser,
    scoreB: winner === "B" ? fs.winner : fs.loser,
    tiebreakA: null,
    tiebreakB: null,
    status: "forfeit",
  };
}

// ---------------------------------------------------------------------------
// Settling: everything the automation does after any action
// ---------------------------------------------------------------------------

function autoForfeitAbsent(tx: Transaction, ctx: EngineContext): boolean {
  let changed = false;
  for (const m of Object.values(tx.state.matches)) {
    if (m.status !== "waiting_venue" && m.status !== "ready") continue;
    const out = (ids: string[]) => ids.length > 0 && ids.every((id) => OUT.has(tx.state.teams[id]?.status ?? "registered"));
    const aOut = out(m.sideA);
    const bOut = out(m.sideB);
    if (!aOut && !bOut) continue;
    applyResult(tx, ctx, m.id, forfeitResult(tx, aOut && bOut ? "both" : aOut ? "A" : "B"));
    changed = true;
  }
  return changed;
}

export function isTournamentComplete(state: EngineState): boolean {
  const ms = Object.values(state.matches);
  if (ms.length === 0 || !ms.every(isFinished)) return false;
  const mainStarted = Object.values(state.rounds).some((r) => r.bracket === "main");
  if (!mainStarted) return false;
  return !canDrawNext(state, "main") && !canDrawNext(state, "consolation") && !canDrawNext(state, "consolation_c");
}

function settle(tx: Transaction, ctx: DrawContext): void {
  for (let i = 0; i < 10; i++) {
    const before = tx.changes.length;
    autoForfeitAbsent(tx, ctx);
    refreshRounds(tx);
    autoAdvance(tx, { ...ctx, seed: `${ctx.seed}:s${i}` });
    if (tx.changes.length === before) break;
  }
  autoAssignVenues(tx, ctx);
  const status = tx.state.tournament.status;
  const complete = isTournamentComplete(tx.state);
  if (status === "live" && complete) tx.updateTournament({ status: "finished" });
  // A correction can reopen a finished tournament; a closed one (archived) never comes back.
  else if (status === "finished" && !complete) tx.updateTournament({ status: "live" });
}

/** Reconciles a drawn match after its sides changed (swap, late entry). */
function refreshDrawnMatch(tx: Transaction, ctx: EngineContext, matchId: string): void {
  const m = tx.state.matches[matchId]!;
  const round = tx.state.rounds[m.roundId]!;
  const fixed = isFixedTree(tx.state, round);
  const full = m.sideA.length > 0 && m.sideB.length > 0;
  if (full && m.status === "bye") {
    if (fixed) unpropagateFixed(tx, m.id, ctx);
    tx.update("match", m.id, { status: "waiting_venue", winner: null, queuedAt: ctx.now });
  } else if (!full && m.status !== "bye") {
    const sideA = m.sideA.length ? m.sideA : m.sideB;
    tx.update("match", m.id, { sideA, sideB: [], status: "bye", winner: "A", venueId: null, scheduledAt: null, queuedAt: null });
    if (fixed) propagateFixed(tx, m.id, ctx);
  } else if (m.status === "bye" && fixed) {
    propagateFixed(tx, m.id, ctx);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function run(tx: Transaction, cmd: Command, ctx: DrawContext): void {
  const state = () => tx.state;
  const t = state().tournament;
  if (t.status === "draft" || t.status === "archived") fail("TOURNAMENT_CLOSED");
  if (t.status === "finished" && !ALLOWED_WHEN_FINISHED.has(cmd.type)) fail("TOURNAMENT_FINISHED");

  switch (cmd.type) {
    case "team.create": {
      const number = Math.max(0, ...Object.values(state().teams).map((x) => x.number)) + 1;
      const id = ctx.newId();
      const active = Object.values(state().teams).filter((x) => x.status !== "waitlist" && x.status !== "withdrawn").length;
      const full = t.maxTeams !== null && active >= t.maxTeams;
      if (full && cmd.refuseIfFull) fail("TOURNAMENT_FULL");
      tx.create("team", {
        id,
        number,
        name: cmd.name?.trim() || null,
        club: teamClubFrom(affiliationOf(cmd.players.map((p) => p.club)), cmd.club?.trim() || null),
        status: full ? "waitlist" : cmd.checkIn ? "checked_in" : "registered",
        seed: null,
        bracket: "main",
        checkedInAt: !full && cmd.checkIn ? ctx.now : null,
      });
      cmd.players.forEach((p, i) =>
        tx.create("player", {
          id: ctx.newId(),
          teamId: id,
          firstName: p.firstName.trim(),
          lastName: p.lastName.trim(),
          position: i + 1,
          ...(p.club !== undefined && { club: playerClub(p.club) }),
        }),
      );
      tx.create("teamSecret", { id, code: teamScoreCode(id) });
      tx.create("registration", { id: ctx.newId(), teamId: id, source: cmd.source ?? "onsite" });
      return;
    }
    case "team.update": {
      const team = state().teams[cmd.teamId] ?? fail("NOT_FOUND", { entity: "team" });
      tx.update("team", team.id, {
        ...(cmd.name !== undefined && { name: cmd.name?.trim() || null }),
        ...(cmd.club !== undefined && { club: cmd.club?.trim() || null }),
        ...(cmd.seed !== undefined && { seed: cmd.seed }),
      });
      if (cmd.players) {
        const existing = Object.values(state().players)
          .filter((p) => p.teamId === team.id)
          .sort((a, b) => a.position - b.position);
        cmd.players.forEach((p, i) => {
          const current = existing[i];
          const club = p.club !== undefined ? { club: playerClub(p.club) } : {};
          if (current) tx.update("player", current.id, { firstName: p.firstName.trim(), lastName: p.lastName.trim(), ...club });
          else tx.create("player", { id: ctx.newId(), teamId: team.id, firstName: p.firstName.trim(), lastName: p.lastName.trim(), position: i + 1, ...club });
        });
        existing.slice(cmd.players.length).forEach((p) => tx.remove("player", p.id));
        // New players' clubs decide the team's club again (N.H. clears it); unknown → the club typed by hand stays.
        const affiliation = teamAffiliation(tx.state, team.id);
        if (affiliation.kind !== "none") tx.update("team", team.id, { club: teamClubFrom(affiliation, null) });
      }
      return;
    }
    case "team.setStatus": {
      const team = state().teams[cmd.teamId] ?? fail("NOT_FOUND", { entity: "team" });
      tx.update("team", team.id, {
        status: cmd.status,
        checkedInAt: cmd.status === "checked_in" ? (team.checkedInAt ?? ctx.now) : cmd.status === "registered" ? null : team.checkedInAt,
      });
      return;
    }
    case "team.lateEntry": {
      const team = state().teams[cmd.teamId] ?? fail("NOT_FOUND", { entity: "team" });
      const main = Object.values(state().rounds).filter((r) => r.bracket === "main" && r.status !== "pending");
      const latest = main.sort((a, b) => b.number - a.number)[0];
      // A bye in the current round becomes a real match against the latecomer.
      const candidates = Object.values(state().matches)
        .filter((m) => m.status === "bye" && m.sideA.length === 1 && m.sideA[0] !== team.id)
        .filter((m) => {
          const r = state().rounds[m.roundId]!;
          if (r.bracket !== "main" || r.phase === "pool" || r.phase === "league") return false;
          return isFixedTree(state(), r) ? r.number === 1 : r.id === latest?.id;
        })
        .sort((a, b) => a.position - b.position);
      for (const m of candidates) {
        try {
          const probe = new Transaction(tx.state);
          probe.update("match", m.id, { sideB: [team.id] });
          refreshDrawnMatch(probe, ctx, m.id);
        } catch (e) {
          if (e instanceof EngineError) continue;
          throw e;
        }
        tx.update("team", team.id, { status: "checked_in", checkedInAt: team.checkedInAt ?? ctx.now });
        tx.update("match", m.id, { sideB: [team.id] });
        refreshDrawnMatch(tx, ctx, m.id);
        return;
      }
      fail("NO_FREE_SLOT");
    }
    case "team.enterBracket": {
      const team = state().teams[cmd.teamId] ?? fail("NOT_FOUND", { entity: "team" });
      if ((cmd.bracket !== "consolation" && cmd.bracket !== "consolation_c") || !isBracketEnabled(state(), cmd.bracket)) {
        fail("BRACKET_DISABLED", { bracket: String(cmd.bracket) });
      }
      // Entries close with the bracket's first draw (later: a forfeit).
      if (roundsOf(state(), cmd.bracket).length) fail("ROUND_ALREADY_DRAWN");
      const set = new Set(team.entries ?? []);
      if (cmd.enter) set.add(cmd.bracket);
      else set.delete(cmd.bracket);
      tx.update("team", team.id, { entries: (["consolation", "consolation_c"] as const).filter((b) => set.has(b)) });
      return;
    }
    case "round.draw": {
      if (cmd.bracket === "main" && !Object.values(state().rounds).some((r) => r.bracket === "main")) {
        if (["published", "registration_closed", "check_in"].includes(t.status)) tx.updateTournament({ status: "live" });
      }
      if (!canDrawNext(state(), cmd.bracket)) {
        // Run the draw anyway to surface the precise reason.
        drawNext(tx, { ...ctx, seed: cmd.seed }, cmd.bracket);
        fail("NOTHING_TO_DRAW");
      }
      drawNext(tx, { ...ctx, seed: cmd.seed }, cmd.bracket);
      return;
    }
    case "round.redraw": {
      const round = state().rounds[cmd.roundId] ?? fail("NOT_FOUND", { entity: "round" });
      const sameGroup = (isFixedTree(state(), round) || round.phase === "pool" || round.phase === "league"
        ? roundsOf(state(), round.bracket, round.phase)
        : [round]
      ).filter(Boolean);
      const later = Object.values(state().rounds).filter(
        (r) => !sameGroup.includes(r) && compareRounds(r, round) > 0 && (r.bracket === round.bracket || round.bracket === "main"),
      );
      if (later.length) fail("NEXT_MATCH_PLAYED");
      const touched = sameGroup.flatMap((r) => matchesOfRound(state(), r.id));
      if (touched.some((m) => hasResult(m) || m.status === "playing" || m.status === "score_submitted" || m.status === "disputed")) fail("ROUND_HAS_RESULTS");
      // Delete and draw again (first rounds include teams checked in since).
      for (const r of sameGroup) deleteRound(tx, r.id);
      drawNext(tx, { ...ctx, seed: cmd.seed }, round.bracket);
      return;
    }
    case "match.swapTeams": {
      const a = requireMatch(tx, cmd.a.matchId);
      const b = requireMatch(tx, cmd.b.matchId);
      if (a.roundId !== b.roundId) fail("SWAP_NOT_ALLOWED");
      // Round-robin schedules (pools, championship) are fixed: swapping would
      // make teams meet twice. Only first pool round of 4-team pools can change.
      const swapRound = state().rounds[a.roundId]!;
      if (swapRound.phase === "league" || (swapRound.phase === "pool" && (swapRound.number !== 1 || state().tournament.config.pools.system !== "gsl" || a.pool === null || [a, b].some((m) => poolTeams(state(), m.pool!).length !== 4)))) {
        fail("SWAP_NOT_ALLOWED");
      }
      for (const m of [a, b]) {
        const ok = m.status === "waiting_venue" || m.status === "ready" || m.status === "bye";
        if (!ok || (isFixedTree(state(), state().rounds[m.roundId]!) && state().rounds[m.roundId]!.number !== 1)) fail("SWAP_NOT_ALLOWED");
      }
      const take = (m: Match, s: Side) => (s === "A" ? m.sideA : m.sideB);
      const ta = take(a, cmd.a.side);
      const tb = take(b, cmd.b.side);
      if (a.id === b.id) {
        tx.update("match", a.id, { sideA: a.sideB, sideB: a.sideA });
      } else {
        tx.update("match", a.id, cmd.a.side === "A" ? { sideA: tb } : { sideB: tb });
        tx.update("match", b.id, cmd.b.side === "A" ? { sideA: ta } : { sideB: ta });
      }
      refreshDrawnMatch(tx, ctx, a.id);
      if (b.id !== a.id) refreshDrawnMatch(tx, ctx, b.id);
      return;
    }
    case "match.setVenue": {
      const m = requireMatch(tx, cmd.matchId);
      if (isFinished(m) || m.status === "pending") fail("MATCH_NOT_PLAYABLE", { match: m.position });
      const venue = state().venues[cmd.venueId] ?? fail("NOT_FOUND", { entity: "venue" });
      if (!venue.available) fail("VENUE_UNAVAILABLE", { venue: venue.label });
      if (state().rules.venueUsage === "parallel") {
        const occupant = Object.values(state().matches).find((x) => x.id !== m.id && x.venueId === venue.id && ACTIVE_ON_VENUE.has(x.status));
        if (occupant) {
          // Swap the two venues.
          tx.update("match", occupant.id, m.venueId ? { venueId: m.venueId } : { venueId: null, status: "waiting_venue", scheduledAt: null });
        }
      }
      tx.update("match", m.id, {
        venueId: venue.id,
        status: m.status === "waiting_venue" ? "ready" : m.status,
        scheduledAt: m.scheduledAt ?? ctx.now,
      });
      return;
    }
    case "match.start": {
      const m = requireMatch(tx, cmd.matchId);
      if (m.status !== "ready" && m.status !== "waiting_venue") fail("MATCH_NOT_PLAYABLE", { match: m.position });
      tx.update("match", m.id, { status: "playing", startedAt: ctx.now });
      return;
    }
    case "match.score": {
      const m = requireMatch(tx, cmd.matchId);
      if (!PLAYABLE.has(m.status) && !hasResult(m)) fail("MATCH_NOT_PLAYABLE", { match: m.position });
      const round = state().rounds[m.roundId]!;
      const knockout = round.phase === "elimination" || round.phase === "final";
      const winner = resolveScore(state().rules.scoring, cmd, knockout);
      applyResult(tx, ctx, m.id, {
        winner,
        scoreA: cmd.scoreA,
        scoreB: cmd.scoreB,
        tiebreakA: cmd.tiebreakA ?? null,
        tiebreakB: cmd.tiebreakB ?? null,
        status: "done",
      });
      return;
    }
    case "match.forfeit": {
      const m = requireMatch(tx, cmd.matchId);
      if (!PLAYABLE.has(m.status) && !hasResult(m)) fail("MATCH_NOT_PLAYABLE", { match: m.position });
      applyResult(tx, ctx, m.id, forfeitResult(tx, cmd.side));
      return;
    }
    case "match.reopen": {
      const m = requireMatch(tx, cmd.matchId);
      if (!hasResult(m)) fail("MATCH_NOT_PLAYABLE", { match: m.position });
      const round = state().rounds[m.roundId]!;
      if (isFixedTree(state(), round)) unpropagateFixed(tx, m.id, ctx);
      else {
        // Later rounds built on this result must be cancelled first.
        if (laterMatchesWith(state(), m, [...m.sideA, ...m.sideB]).length) fail("NEXT_MATCH_PLAYED");
        if (round.phase === "pool" && roundsOf(state(), "main", "final").length) fail("FINAL_PHASE_DRAWN");
      }
      tx.update("match", m.id, {
        winner: null,
        scoreA: null,
        scoreB: null,
        tiebreakA: null,
        tiebreakB: null,
        endedAt: null,
        // Its venue may have been given to another match since: back to the queue
        // (with its original place, so it is served first).
        status: "waiting_venue",
        venueId: null,
        scheduledAt: null,
        queuedAt: m.queuedAt ?? ctx.now,
      });
      // A round played to the end, reopened since: « live » (shown like « drawn »). Recorded, so the
      // two-day pause knows it was reached whatever happens to the match next (started, flagged…).
      if (round.status === "finished") tx.update("round", round.id, { status: "live" });
      return;
    }
    case "match.setFlag": {
      const m = requireMatch(tx, cmd.matchId);
      if (!PLAYABLE.has(m.status)) fail("MATCH_NOT_PLAYABLE", { match: m.position });
      tx.update("match", m.id, { status: cmd.flag === "clear" ? (m.venueId ? "ready" : "waiting_venue") : cmd.flag });
      return;
    }
    case "venue.add": {
      const position = Math.max(0, ...Object.values(state().venues).map((v) => v.position)) + 1;
      tx.create("venue", { id: ctx.newId(), label: cmd.label.trim() || String(position), position, reservedForFinals: Boolean(cmd.reservedForFinals), available: true });
      return;
    }
    case "venue.update": {
      const venue = state().venues[cmd.venueId] ?? fail("NOT_FOUND", { entity: "venue" });
      tx.update("venue", venue.id, {
        ...(cmd.label !== undefined && { label: cmd.label.trim() || venue.label }),
        ...(cmd.available !== undefined && { available: cmd.available }),
        ...(cmd.reservedForFinals !== undefined && { reservedForFinals: cmd.reservedForFinals }),
      });
      if (cmd.available === false || cmd.reservedForFinals) {
        // Matches waiting on this venue go back to the queue.
        for (const m of Object.values(state().matches)) {
          if (m.venueId === venue.id && m.status === "ready") tx.update("match", m.id, { venueId: null, status: "waiting_venue", scheduledAt: null });
        }
      }
      return;
    }
    case "tournament.setStatus": {
      if (!STATUS_FLOW.includes(t.status) || !STATUS_FLOW.includes(cmd.status)) fail("INVALID_STATUS_CHANGE");
      // The only way to "archived" is tournament.close (finished tournaments only).
      if (cmd.status === "archived") fail("INVALID_STATUS_CHANGE");
      tx.updateTournament({ status: cmd.status });
      return;
    }
    case "tournament.resume": {
      if (!pausedAt(state())) fail("NOTHING_TO_DRAW");
      drawNext(tx, { ...ctx, seed: cmd.seed ?? ctx.seed }, "main");
      return;
    }
    case "tournament.close": {
      if (t.status !== "finished") fail("INVALID_STATUS_CHANGE");
      tx.updateTournament({ status: "archived" });
      return;
    }
  }
}

/**
 * Applies an organizer command. Pure: same state + same command + same
 * context = same result, on the server and on an offline device.
 * Throws EngineError when the command is not allowed.
 */
export function applyCommand(state: EngineState, cmd: Command, ctx: EngineContext & { seed?: string }): CommandResult {
  const tx = new Transaction(state);
  const drawCtx: DrawContext = { ...ctx, seed: ctx.seed ?? `${state.tournament.id}:${ctx.now}` };
  run(tx, cmd, drawCtx);
  settle(tx, drawCtx);
  return { state: tx.state, changes: tx.compacted() };
}
