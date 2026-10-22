import { compareRounds, isWalkover, propagateFixed, unpropagateFixed } from "./bracket";
import { fail } from "./errors";
import {
  byeCount,
  eligibleTeams,
  hasResult,
  isFinished,
  isFixedTree,
  isRoundComplete,
  largestPowerOfTwo,
  lastRound,
  loserTeams,
  matchesOfRound,
  nextPowerOfTwo,
  pairKey,
  playedPairs,
  roundsOf,
  teamsInRound,
  winnerTeams,
} from "./queries";
import {
  cadragePairing,
  distributeInPools,
  fixedBracketFirstRound,
  meleeSides,
  poolSizes,
  randomPairing,
  roundRobinSchedule,
  swissPairing,
  type PairingTeam,
} from "./pairing";
import { createRng } from "./rng";
import { eliminationRanking, rankTeams } from "./standings";
import type { Transaction } from "./tx";
import type { Bracket, EngineContext, EngineState, Match, Phase, Round, RoundKind, RoundStatus, Team } from "./types";

export interface DrawContext extends EngineContext {
  /** Base seed of this draw; sub-draws derive their own seed from it. */
  seed: string;
}

const toPairing = (t: Team): PairingTeam => ({ id: t.id, club: t.club, seed: t.seed });
const OUT: ReadonlySet<Team["status"]> = new Set(["forfeit", "withdrawn"]);
const stillIn = (state: EngineState) => (id: string) => {
  const t = state.teams[id];
  return Boolean(t) && !OUT.has(t!.status);
};

export function poolLabel(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < 26 ? letters[index]! : `${letters[Math.floor(index / 26) - 1]}${letters[index % 26]}`;
}

export function defaultSwissRounds(teams: number): number {
  return Math.max(3, Math.ceil(Math.log2(Math.max(2, teams))));
}

export function totalRounds(state: EngineState, phase: "swiss" | "melee", participants: number): number {
  const cfg = state.tournament.config;
  if (cfg.rounds) return cfg.rounds;
  return phase === "swiss" ? defaultSwissRounds(participants) : 4;
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

function newRound(tx: Transaction, ctx: DrawContext, bracket: Bracket, phase: Phase, number: number, status: RoundStatus): Round {
  return tx.create("round", {
    id: ctx.newId(),
    bracket,
    phase,
    number,
    status,
    seed: status === "pending" ? null : `${ctx.seed}:${bracket}:${phase}:${number}`,
    drawnAt: status === "pending" ? null : ctx.now,
  });
}

/** Creates a match; its status follows from the sides (playable, bye, empty). */
export function newMatch(
  tx: Transaction,
  ctx: EngineContext,
  round: Round,
  position: number,
  sideA: string[],
  sideB: string[],
  pool: string | null = null,
  pending = false,
): Match {
  let a = sideA;
  let b = sideB;
  let status: Match["status"];
  let winner: Match["winner"] = null;
  if (pending) status = "pending";
  else if (a.length && b.length) status = "waiting_venue";
  else if (a.length || b.length) {
    status = "bye";
    winner = "A";
    if (!a.length) [a, b] = [b, []];
  } else status = "forfeit";
  return tx.create("match", {
    id: ctx.newId(),
    roundId: round.id,
    position,
    pool,
    sideA: a,
    sideB: b,
    venueId: null,
    scheduledAt: null,
    startedAt: null,
    endedAt: null,
    queuedAt: status === "waiting_venue" ? ctx.now : null,
    scoreA: null,
    scoreB: null,
    tiebreakA: null,
    tiebreakB: null,
    winner,
    status,
  });
}

function deleteRound(tx: Transaction, roundId: string): void {
  for (const m of matchesOfRound(tx.state, roundId)) tx.remove("match", m.id);
  tx.remove("round", roundId);
}

// ---------------------------------------------------------------------------
// Elimination (main or consolation bracket, or the final phase after pools)
// ---------------------------------------------------------------------------

function buildFixedTree(tx: Transaction, ctx: DrawContext, bracket: Bracket, phase: Phase, teams: PairingTeam[], opts: { avoidSameClub: boolean; seeding: boolean }): void {
  const rng = createRng(`${ctx.seed}:${bracket}:${phase}:tree`);
  const size = nextPowerOfTwo(teams.length);
  const roundsCount = Math.log2(size);
  const first = fixedBracketFirstRound(teams, size, rng, opts);
  const rounds: Round[] = [];
  for (let r = 1; r <= roundsCount; r++) rounds.push(newRound(tx, ctx, bracket, phase, r, r === 1 ? "drawn" : "pending"));
  const r1: Match[] = first.map(([a, b], i) => newMatch(tx, ctx, rounds[0]!, i + 1, [a], b ? [b] : []));
  for (let r = 2; r <= roundsCount; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) newMatch(tx, ctx, rounds[r - 1]!, p, [], [], null, true);
  }
  for (const m of r1) if (m.status === "bye") propagateFixed(tx, m.id, ctx);
}

export interface EliminationDrawPlan {
  /** Games played in the round. */
  matches: number;
  /** Teams that go through « d'office » (cadrage, or safety net after it). */
  office: number;
  /** Team sitting out before the cadrage point (odd count). */
  exempt: number;
  kind: RoundKind;
}

/**
 * Single rule for a new-draw elimination round (A, B or C), with T teams
 * still in, after `playedRounds` rounds of this bracket:
 * - before the cadrage point (fewer than k games, no pools): full draw, one
 *   exempt if T is odd;
 * - at the cadrage point and after (or right after the pools): if T is a
 *   power of two, full draw; else T − P games and 2P − T teams « d'office »,
 *   so that P teams are left. The round at the cadrage point is a « cadrage »;
 *   a later one (double forfeit, withdrawal) keeps its normal name.
 */
export function eliminationDrawPlan(T: number, playedRounds: number, k: number, fromPools: boolean): EliminationDrawPlan {
  if (!fromPools && playedRounds < k) return { matches: Math.floor(T / 2), office: 0, exempt: T % 2, kind: "partie" };
  const P = largestPowerOfTwo(Math.max(1, T));
  if (P === T) return { matches: T / 2, office: 0, exempt: 0, kind: "partie" };
  const atPoint = fromPools ? playedRounds === 0 : playedRounds === k;
  return { matches: T - P, office: 2 * P - T, exempt: 0, kind: atPoint ? "cadrage" : "partie" };
}

function drawRedrawRound(tx: Transaction, ctx: DrawContext, bracket: Bracket, phase: Phase, number: number, teams: PairingTeam[], avoidSameClub: boolean): void {
  const rng = createRng(`${ctx.seed}:${bracket}:${phase}:${number}`);
  const plan = eliminationDrawPlan(teams.length, number - 1, tx.state.tournament.config.cadrage.afterRound, phase === "final");
  let pairs: [string, string][];
  let singles: string[];
  if (plan.office > 0) {
    ({ pairs, office: singles } = cadragePairing(teams, largestPowerOfTwo(teams.length), rng, { avoidSameClub }));
  } else {
    const drawn = randomPairing(teams, rng, { avoidSameClub, byes: (id) => byeCount(tx.state, id, bracket) });
    pairs = drawn.pairs;
    singles = drawn.bye ? [drawn.bye] : [];
  }
  // The « cadrage » kind is not stored on the round: roundLabel derives it
  // (round at the cadrage point, field not a power of two), so a state read
  // back from the database is identical.
  const round = newRound(tx, ctx, bracket, phase, number, "drawn");
  pairs.forEach(([a, b], i) => newMatch(tx, ctx, round, i + 1, [a], [b]));
  singles.forEach((id, i) => newMatch(tx, ctx, round, pairs.length + i + 1, [id], []));
}

/**
 * Elimination bracket (A, B, C or the final phase after pools). A fixed tree
 * is drawn once; otherwise each round is a new draw following
 * `eliminationDrawPlan`.
 */
function drawElimination(tx: Transaction, ctx: DrawContext, bracket: Bracket, phase: Phase, entrants: () => PairingTeam[], firstRoundOpts: { avoidSameClub: boolean; seeding: boolean }): void {
  const state = tx.state;
  const rounds = roundsOf(state, bracket, phase);
  if (rounds.length === 0) {
    const teams = entrants();
    if (teams.length < 2) fail("NOT_ENOUGH_TEAMS", { count: teams.length });
    if (state.tournament.config.bracketMode === "fixed") return buildFixedTree(tx, ctx, bracket, phase, teams, firstRoundOpts);
    // « Même club évité » (or « pas sa poule » for the final phase): first draw of the bracket only.
    return drawRedrawRound(tx, ctx, bracket, phase, 1, teams, firstRoundOpts.avoidSameClub);
  }
  if (isFixedTree(state, rounds[0]!)) fail("ROUND_ALREADY_DRAWN");
  const last = rounds[rounds.length - 1]!;
  if (!isRoundComplete(state, last.id)) fail("ROUND_INCOMPLETE", { round: last.number });
  const winners = [...new Set(matchesOfRound(state, last.id).flatMap(winnerTeams))].filter(stillIn(state));
  if (winners.length < 2) fail("NOTHING_TO_DRAW");
  drawRedrawRound(tx, ctx, bracket, phase, last.number + 1, winners.map((id) => toPairing(state.teams[id]!)), false);
}

/** A new-draw bracket can draw its next round: last round over and at least two winners still in. */
function canContinueElimination(state: EngineState, bracket: Bracket, phase: Phase): boolean {
  const rounds = roundsOf(state, bracket, phase);
  if (isFixedTree(state, rounds[0]!)) return false;
  const last = rounds[rounds.length - 1]!;
  return isRoundComplete(state, last.id) && matchesOfRound(state, last.id).flatMap(winnerTeams).filter(stillIn(state)).length >= 2;
}

// ---------------------------------------------------------------------------
// Pools then final phase
// ---------------------------------------------------------------------------

export function poolMatches(state: EngineState, label: string): Match[] {
  return Object.values(state.matches).filter((m) => m.pool === label && state.rounds[m.roundId]?.phase === "pool");
}

export function poolTeams(state: EngineState, label: string): string[] {
  const ids = new Set<string>();
  for (const m of poolMatches(state, label)) [...m.sideA, ...m.sideB].forEach((id) => ids.add(id));
  return [...ids].sort((a, b) => (state.teams[a]?.number ?? 0) - (state.teams[b]?.number ?? 0));
}

export function poolLabels(state: EngineState): string[] {
  return [...new Set(Object.values(state.matches).filter((m) => m.pool && state.rounds[m.roundId]?.phase === "pool").map((m) => m.pool!))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
}

const isGslPool = (state: EngineState, label: string) => state.tournament.config.pools.system === "gsl" && poolTeams(state, label).length === 4;

function byPoolRound(state: EngineState, label: string): Map<number, Match[]> {
  const out = new Map<number, Match[]>();
  for (const m of poolMatches(state, label)) {
    const n = state.rounds[m.roundId]!.number;
    out.set(n, [...(out.get(n) ?? []), m].sort((a, b) => a.position - b.position));
  }
  return out;
}

export function isPoolComplete(state: EngineState, label: string): boolean {
  const ms = poolMatches(state, label);
  if (ms.length === 0 || !ms.every(isFinished)) return false;
  if (isGslPool(state, label)) return (byPoolRound(state, label).get(3)?.length ?? 0) > 0;
  return true;
}

/** Final order of a pool (best first). */
export function poolRanking(state: EngineState, label: string): string[] {
  if (isGslPool(state, label)) {
    const rounds = byPoolRound(state, label);
    const r1Winners = new Set((rounds.get(1) ?? []).flatMap(winnerTeams));
    const r2 = rounds.get(2) ?? [];
    const wm = r2.find((m) => [...m.sideA, ...m.sideB].some((id) => r1Winners.has(id)));
    const lm = r2.find((m) => m !== wm);
    const barrage = rounds.get(3)?.[0];
    const order = [
      ...(wm ? winnerTeams(wm) : []),
      ...(barrage ? winnerTeams(barrage) : []),
      ...(barrage ? loserTeams(barrage) : []),
      ...(lm ? loserTeams(lm) : []),
    ];
    const rest = poolTeams(state, label).filter((id) => !order.includes(id));
    return [...new Set([...order, ...rest])];
  }
  return rankTeams(state, poolTeams(state, label), poolMatches(state, label), state.tournament.config.ranking, `${state.tournament.id}:pool:${label}`).map((r) => r.id);
}

function drawPools(tx: Transaction, ctx: DrawContext): void {
  const state = tx.state;
  const cfg = state.tournament.config;
  const teams = eligibleTeams(state);
  if (teams.length < 3) fail("NOT_ENOUGH_TEAMS", { count: teams.length });
  const rng = createRng(`${ctx.seed}:pools`);
  const sizes = poolSizes(teams.length, cfg.pools.size);
  const pools = distributeInPools(teams.map(toPairing), sizes, rng, { seeding: cfg.draw.seeding, avoidSameClub: cfg.draw.avoidSameClubFirstRound });

  const plans = pools.map((members, i) => {
    const label = poolLabel(i);
    if (cfg.pools.system === "gsl" && members.length === 4) {
      const [a, b, c, d] = members as [string, string, string, string];
      return { label, rounds: [[[a, d], [b, c]]] as [string | null, string | null][][], gsl: true };
    }
    return { label, rounds: roundRobinSchedule(rng.shuffle(members)), gsl: false };
  });
  const roundCount = Math.max(...plans.map((p) => (p.gsl ? 3 : p.rounds.length)));
  const rounds: Round[] = [];
  for (let r = 1; r <= roundCount; r++) rounds.push(newRound(tx, ctx, "main", "pool", r, "drawn"));
  const positions = new Map<number, number>();
  for (const plan of plans) {
    plan.rounds.forEach((pairs, r) => {
      for (const [a, b] of pairs) {
        if (!a || !b) continue;
        const pos = (positions.get(r) ?? 0) + 1;
        positions.set(r, pos);
        newMatch(tx, ctx, rounds[r]!, pos, [a], [b], plan.label);
      }
    });
  }
}

/** Losers that go on in a pool of 4: none after a double forfeit (both teams are out, they never play together). */
const gslLosers = (m: Match): string[] => (m.winner === null ? [] : loserTeams(m));

/** Pétanque-style pool of 4: winners' match, losers' match, then a decider. */
function gslProgress(tx: Transaction, ctx: EngineContext, label: string): void {
  const state = tx.state;
  if (!isGslPool(state, label)) return;
  const rounds = byPoolRound(state, label);
  const poolRound = (n: number) => roundsOf(state, "main", "pool").find((r) => r.number === n);
  const nextPos = (round: Round) => Math.max(0, ...matchesOfRound(tx.state, round.id).map((m) => m.position)) + 1;
  const r1 = rounds.get(1) ?? [];
  if (r1.length === 2 && r1.every(isFinished) && !rounds.get(2)) {
    const round = poolRound(2)!;
    newMatch(tx, ctx, round, nextPos(round), winnerTeams(r1[0]!), winnerTeams(r1[1]!), label);
    newMatch(tx, ctx, round, nextPos(round), gslLosers(r1[0]!), gslLosers(r1[1]!), label);
    return;
  }
  const r2 = rounds.get(2) ?? [];
  if (r2.length === 2 && r2.every(isFinished) && !rounds.get(3)) {
    // The winners' match is drawn first (lower position), even when it is empty after two double forfeits.
    const [wm, lm] = [...r2].sort((x, y) => x.position - y.position) as [Match, Match];
    const round = poolRound(3)!;
    newMatch(tx, ctx, round, nextPos(round), gslLosers(wm), winnerTeams(lm), label);
  }
}

/**
 * Qualified teams of each pool. A team that withdrew or forfeited is set aside
 * BEFORE the cut, so the next team of its pool takes the place — as long as
 * the final phase does not include it yet. Once the final phase is drawn, the
 * teams in it keep their place (a later forfeit is played as a forfeit), and a
 * team already engaged in the consolation bracket is never promoted.
 */
export function qualifiers(state: EngineState): { id: string; pool: string; place: number }[] {
  const q = state.tournament.config.pools.qualifiers;
  const inFinal = new Set<string>();
  const inConsolation = new Set<string>();
  for (const m of Object.values(state.matches)) {
    const r = state.rounds[m.roundId];
    const set = r?.bracket === "main" && r.phase === "final" ? inFinal : r?.bracket === "consolation" ? inConsolation : null;
    if (set) for (const id of [...m.sideA, ...m.sideB]) set.add(id);
  }
  const eligible = (id: string) => inFinal.has(id) || (stillIn(state)(id) && !inConsolation.has(id));
  return poolLabels(state).flatMap((label) =>
    poolRanking(state, label)
      .filter(eligible)
      .slice(0, q)
      .map((id, i) => ({ id, pool: label, place: i + 1 })),
  );
}

function drawFinalPhase(tx: Transaction, ctx: DrawContext): void {
  const state = tx.state;
  const labels = poolLabels(state);
  if (!labels.every((l) => isPoolComplete(state, l))) fail("ROUND_INCOMPLETE");
  const q = qualifiers(state).filter((x) => stillIn(state)(x.id));
  // Never against a team of its own pool in the first final round. A fixed
  // tree seeds the pool winners; a new draw (pétanque) is 100 % random.
  const teams: PairingTeam[] = q.map((x) => ({ id: x.id, club: `pool:${x.pool}`, seed: x.place === 1 ? labels.indexOf(x.pool) + 1 : null }));
  drawElimination(tx, ctx, "main", "final", () => teams, { avoidSameClub: true, seeding: true });
}

// ---------------------------------------------------------------------------
// Consolation ("concours complémentaire")
// ---------------------------------------------------------------------------

/** Extra brackets: concours B ("consolation") and concours C ("consolation_c"). */
export type ExtraBracket = Exclude<Bracket, "main">;

/** The C is only played when the B started with at least this many teams. */
export const C_MIN_B_TEAMS = 4;

const KNOCKOUT_FORMATS: ReadonlySet<string> = new Set(["single_elimination", "pools_then_bracket"]);

export function bracketSettings(state: EngineState, bracket: ExtraBracket) {
  const cfg = state.tournament.config;
  return bracket === "consolation" ? cfg.consolation : cfg.consolationC;
}

/** The B (or the C, which needs the B) is part of this tournament. */
export function isBracketEnabled(state: EngineState, bracket: ExtraBracket): boolean {
  const cfg = state.tournament.config;
  if (!KNOCKOUT_FORMATS.has(cfg.format) || !cfg.consolation.enabled) return false;
  return bracket === "consolation" || cfg.consolationC.enabled;
}

/** Teams in the first round of a bracket (exempt and « d'office » included), 0 before its draw. */
export function bracketStartCount(state: EngineState, bracket: Bracket): number {
  const first = roundsOf(state, bracket, "elimination")[0];
  return first ? teamsInRound(state, first) : 0;
}

/**
 * Teams that go to the B or the C:
 * - B: losers of the A's 1st game (never its exempt), or the pool non-qualifiers;
 * - C: losers of the B's 1st game, only if the B started with at least 4 teams.
 * With « opt_in » entry, only the teams entered with team.enterBracket.
 */
export function consolationEntrants(state: EngineState, bracket: ExtraBracket): PairingTeam[] {
  const cfg = state.tournament.config;
  let ids: string[];
  if (bracket === "consolation_c") {
    const first = roundsOf(state, "consolation", "elimination")[0];
    if (!first || !isRoundComplete(state, first.id)) fail("ROUND_INCOMPLETE", { round: 1 });
    const count = teamsInRound(state, first);
    if (count < C_MIN_B_TEAMS) fail("NOT_ENOUGH_TEAMS", { count });
    ids = matchesOfRound(state, first.id).flatMap(loserTeams);
  } else if (cfg.format === "pools_then_bracket" && cfg.consolation.source === "pool_non_qualified") {
    const labels = poolLabels(state);
    if (labels.length === 0 || !labels.every((l) => isPoolComplete(state, l))) fail("ROUND_INCOMPLETE");
    const qualified = new Set(qualifiers(state).map((x) => x.id));
    ids = labels.flatMap((l) => poolTeams(state, l)).filter((id) => !qualified.has(id));
  } else {
    // Losers of a game of the A: its elimination rounds, or the 1st round of its final phase.
    const phase: Phase = cfg.format === "pools_then_bracket" ? "final" : "elimination";
    const number = phase === "elimination" ? cfg.consolation.losersOfRound : 1;
    const source = roundsOf(state, "main", phase).find((r) => r.number === number);
    if (!source || !isRoundComplete(state, source.id)) fail("ROUND_INCOMPLETE", { round: number });
    ids = matchesOfRound(state, source.id).flatMap(loserTeams);
  }
  const optIn = bracketSettings(state, bracket).entry === "opt_in";
  return [...new Set(ids)]
    .filter(stillIn(state))
    .filter((id) => !optIn || Boolean(state.teams[id]!.entries?.includes(bracket)))
    .map((id) => toPairing(state.teams[id]!));
}

// ---------------------------------------------------------------------------
// Swiss, round robin ("championnat"), mêlée tournante
// ---------------------------------------------------------------------------

function participants(state: EngineState, phase: Phase): string[] {
  const first = roundsOf(state, "main", phase)[0];
  if (!first) return eligibleTeams(state).map((t) => t.id);
  const ids = new Set(matchesOfRound(state, first.id).flatMap((m) => [...m.sideA, ...m.sideB]));
  return [...ids].filter(stillIn(state));
}

function drawSwiss(tx: Transaction, ctx: DrawContext): void {
  const state = tx.state;
  const rounds = roundsOf(state, "main", "swiss");
  const ids = participants(state, "swiss");
  if (ids.length < 2) fail("NOT_ENOUGH_TEAMS", { count: ids.length });
  const total = totalRounds(state, "swiss", ids.length);
  const last = rounds[rounds.length - 1];
  if (last && !isRoundComplete(state, last.id)) fail("ROUND_INCOMPLETE", { round: last.number });
  if (rounds.length >= total) fail("NOTHING_TO_DRAW");
  const number = rounds.length + 1;
  const rng = createRng(`${ctx.seed}:main:swiss:${number}`);
  const round = newRound(tx, ctx, "main", "swiss", number, "drawn");

  if (number === 1) {
    const { pairs, bye } = randomPairing(ids.map((id) => toPairing(state.teams[id]!)), rng, {
      avoidSameClub: state.tournament.config.draw.avoidSameClubFirstRound,
    });
    pairs.forEach(([a, b], i) => newMatch(tx, ctx, round, i + 1, [a], [b]));
    if (bye) newMatch(tx, ctx, round, pairs.length + 1, [bye], []);
    return;
  }
  const matches = Object.values(state.matches).filter((m) => state.rounds[m.roundId]?.phase === "swiss");
  const ranked = rankTeams(state, ids, matches, state.tournament.config.ranking, `${ctx.seed}:rank:${number}`).map((r) => r.id);
  let order = ranked;
  let bye: string | null = null;
  if (order.length % 2 === 1) {
    const minByes = Math.min(...order.map((id) => byeCount(state, id)));
    bye = [...order].reverse().find((id) => byeCount(state, id) === minByes)!;
    order = order.filter((id) => id !== bye);
  }
  const pairs = swissPairing(order, playedPairs(state, "main"));
  pairs.forEach(([a, b], i) => newMatch(tx, ctx, round, i + 1, [a], [b]));
  if (bye) newMatch(tx, ctx, round, pairs.length + 1, [bye], []);
}

function drawLeague(tx: Transaction, ctx: DrawContext): void {
  const state = tx.state;
  if (roundsOf(state, "main", "league").length) fail("ROUND_ALREADY_DRAWN");
  const teams = eligibleTeams(state);
  if (teams.length < 2) fail("NOT_ENOUGH_TEAMS", { count: teams.length });
  const rng = createRng(`${ctx.seed}:main:league`);
  const schedule = roundRobinSchedule(rng.shuffle(teams.map((t) => t.id)));
  schedule.forEach((pairs, r) => {
    const round = newRound(tx, ctx, "main", "league", r + 1, "drawn");
    let pos = 0;
    for (const [a, b] of pairs) if (a && b) newMatch(tx, ctx, round, ++pos, [a], [b]);
  });
}

function drawMelee(tx: Transaction, ctx: DrawContext): void {
  const state = tx.state;
  const rounds = roundsOf(state, "main", "melee");
  const ids = participants(state, "melee");
  const size = state.rules.teamSize;
  if (ids.length < size * 2) fail("NOT_ENOUGH_TEAMS", { count: ids.length });
  const total = totalRounds(state, "melee", ids.length);
  const last = rounds[rounds.length - 1];
  if (last && !isRoundComplete(state, last.id)) fail("ROUND_INCOMPLETE", { round: last.number });
  if (rounds.length >= total) fail("NOTHING_TO_DRAW");
  const number = rounds.length + 1;
  const rng = createRng(`${ctx.seed}:main:melee:${number}`);
  const partners = new Set<string>();
  for (const m of Object.values(state.matches)) {
    if (state.rounds[m.roundId]?.phase !== "melee") continue;
    for (const side of [m.sideA, m.sideB])
      for (let i = 0; i < side.length; i++) for (let j = i + 1; j < side.length; j++) partners.add(pairKey(side[i]!, side[j]!));
  }
  const { matches, resting } = meleeSides(ids, size, rng, partners, (id) => byeCount(state, id));
  const round = newRound(tx, ctx, "main", "melee", number, "drawn");
  matches.forEach(([a, b], i) => newMatch(tx, ctx, round, i + 1, a, b));
  resting.forEach((id, i) => newMatch(tx, ctx, round, matches.length + i + 1, [id], []));
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Draws the next round of a bracket according to the tournament format. */
export function drawNext(tx: Transaction, ctx: DrawContext, bracket: Bracket): void {
  const state = tx.state;
  const cfg = state.tournament.config;
  if (bracket !== "main") {
    if (!isBracketEnabled(state, bracket)) fail("NOTHING_TO_DRAW");
    return drawElimination(tx, ctx, bracket, "elimination", () => consolationEntrants(tx.state, bracket), { avoidSameClub: false, seeding: false });
  }
  switch (cfg.format) {
    case "single_elimination":
      return drawElimination(tx, ctx, "main", "elimination", () => eligibleTeams(tx.state).map(toPairing), {
        avoidSameClub: cfg.draw.avoidSameClubFirstRound,
        seeding: cfg.draw.seeding,
      });
    case "pools_then_bracket":
      if (roundsOf(state, "main", "pool").length === 0) return drawPools(tx, ctx);
      if (roundsOf(state, "main", "final").length) return drawElimination(tx, ctx, "main", "final", () => [], { avoidSameClub: false, seeding: false });
      return drawFinalPhase(tx, ctx);
    case "swiss":
      return drawSwiss(tx, ctx);
    case "round_robin":
      return drawLeague(tx, ctx);
    case "melee_rotation":
      return drawMelee(tx, ctx);
  }
}

/** True when the organizer (or the automation) can draw the next round now. */
export function canDrawNext(state: EngineState, bracket: Bracket): boolean {
  const cfg = state.tournament.config;
  if (bracket !== "main") {
    if (!isBracketEnabled(state, bracket)) return false;
    const rounds = roundsOf(state, bracket, "elimination");
    if (rounds.length === 0) {
      try {
        return consolationEntrants(state, bracket).length >= 2;
      } catch {
        return false;
      }
    }
    return canContinueElimination(state, bracket, "elimination");
  }
  switch (cfg.format) {
    case "single_elimination": {
      const rounds = roundsOf(state, "main", "elimination");
      if (rounds.length === 0) return eligibleTeams(state).length >= 2;
      return canContinueElimination(state, "main", "elimination");
    }
    case "pools_then_bracket": {
      if (roundsOf(state, "main", "pool").length === 0) return eligibleTeams(state).length >= 3;
      if (roundsOf(state, "main", "final").length) return canContinueElimination(state, "main", "final");
      const labels = poolLabels(state);
      // A final needs two qualifiers still in: otherwise the pool winner wins.
      return labels.length > 0 && labels.every((l) => isPoolComplete(state, l)) && qualifiers(state).filter((x) => stillIn(state)(x.id)).length >= 2;
    }
    case "round_robin":
      return roundsOf(state, "main", "league").length === 0 && eligibleTeams(state).length >= 2;
    case "swiss":
    case "melee_rotation": {
      const phase = cfg.format === "swiss" ? "swiss" : "melee";
      const rounds = roundsOf(state, "main", phase);
      const ids = participants(state, phase);
      const last = rounds[rounds.length - 1];
      if (last && !isRoundComplete(state, last.id)) return false;
      return rounds.length < totalRounds(state, phase, ids.length) && ids.length >= (phase === "melee" ? state.rules.teamSize * 2 : 2);
    }
  }
}

/** The A's draw the two-day pause holds: its phase, its round number and the teams still in. */
export interface PausePoint {
  phase: Phase;
  round: number;
  teams: number;
}

/**
 * Two-day tournament (`config.pause`): the A's next draw when the pause holds
 * it, else null. Derived from the state, nothing is stored: the draw that
 * resumes (tournament.resume or a manual round.draw) makes it false, and
 * undoing that draw brings the pause back.
 * - before.remaining R: the next round starts with R teams or fewer, the last
 *   one with more (so it holds once, e.g. 64 teams, R = 16: before the 1/8);
 * - "afterPools": before the 1st round of the final phase;
 * - afterRound n: before round n + 1 of the A (of its final phase with pools).
 * A fixed tree is drawn at once: only a pause before it (after the pools) applies.
 */
export function pausedAt(state: EngineState): PausePoint | null {
  const rule = state.tournament.config.pause;
  if (rule === null || !Object.values(state.rounds).some((r) => r.bracket === "main") || !canDrawNext(state, "main")) return null;
  const format = state.tournament.config.format;
  const phase: Phase =
    format === "pools_then_bracket" ? "final" : format === "swiss" ? "swiss" : format === "melee_rotation" ? "melee" : format === "round_robin" ? "league" : "elimination";
  const last = lastRound(state, "main", phase);
  const before = last ? teamsInRound(state, last) : Infinity;
  const teams = last
    ? new Set(matchesOfRound(state, last.id).flatMap(winnerTeams).filter(stillIn(state))).size
    : qualifiers(state).filter((x) => stillIn(state)(x.id)).length;
  const point: PausePoint = { phase, round: (last?.number ?? 0) + 1, teams };
  if (rule === "afterPools") return phase === "final" && !last ? point : null;
  if ("afterRound" in rule) return point.round === rule.afterRound + 1 ? point : null;
  if (phase !== "elimination" && phase !== "final") return null;
  return teams <= rule.before.remaining && before > rule.before.remaining ? point : null;
}

/**
 * True when the A's round in progress is the last one before the pause: once
 * it is over, pausedAt holds the A's next draw. Derived from the state like
 * pausedAt (nothing stored). Earlier rounds of the A never make it true.
 */
function pausePending(state: EngineState): boolean {
  const rule = state.tournament.config.pause;
  if (rule === null) return false;
  const format = state.tournament.config.format;
  if (rule === "afterPools") {
    // The B and the C of a pools tournament start from finished pools or the final phase: nothing to draw before.
    return format === "pools_then_bracket" && roundsOf(state, "main", "pool").length > 0 && roundsOf(state, "main", "final").length === 0;
  }
  const phase: Phase =
    format === "pools_then_bracket" ? "final" : format === "swiss" ? "swiss" : format === "melee_rotation" ? "melee" : format === "round_robin" ? "league" : "elimination";
  const last = lastRound(state, "main", phase);
  if (!last || phase === "league" || isRoundComplete(state, last.id) || isFixedTree(state, last)) return false;
  if (phase === "swiss" || phase === "melee") {
    return "afterRound" in rule && last.number === rule.afterRound && last.number < totalRounds(state, phase, participants(state, phase).length);
  }
  // Teams left once the round is over: the winners already known, plus one per match still to play.
  const ms = matchesOfRound(state, last.id);
  const teams = new Set(ms.filter(isFinished).flatMap(winnerTeams).filter(stillIn(state))).size + ms.filter((m) => !isFinished(m)).length;
  if (teams < 2) return false;
  if ("afterRound" in rule) return last.number === rule.afterRound;
  return teams <= rule.before.remaining && teamsInRound(state, last) > rule.before.remaining;
}

/**
 * True when the A's round before the pause has already been played to the end
 * once and a match of it was reopened since: match.reopen records it on the
 * round (status « live » = played to the end once, not complete any more), so
 * it holds whatever happens to the match next (pitch, start, flag), and a match
 * that was never finished never makes it true. With pools, every match is
 * finished or in such a round. Call only when pausePending is true.
 */
function pauseReachedBefore(state: EngineState): boolean {
  const format = state.tournament.config.format;
  const phase: Phase = state.tournament.config.pause === "afterPools" ? "pool"
    : format === "pools_then_bracket" ? "final" : format === "swiss" ? "swiss" : format === "melee_rotation" ? "melee" : "elimination";
  const rounds = phase === "pool" ? roundsOf(state, "main", "pool") : [lastRound(state, "main", phase)!];
  const reopened = new Set(rounds.filter((r) => r.status === "live").map((r) => r.id));
  return reopened.size > 0 && rounds.every((r) => reopened.has(r.id) || matchesOfRound(state, r.id).every(isFinished));
}

/**
 * True while the two-day pause holds the brackets: pausedAt is set, or the A's
 * round before the pause was played to the end and one of its matches was
 * reopened during the night (no draw of the A, the B or the C until it is
 * scored again and the tournament resumed). Same rule as autoAdvance, for the
 * scoring table (no draw button offered meanwhile).
 */
export function isPauseHeld(state: EngineState): boolean {
  if (pausedAt(state)) return true;
  return pausePending(state) && pauseReachedBefore(state);
}

/**
 * Draws that happen on their own once the previous round is over (never the
 * first one). The two-day pause stops all of them: the B and the C wait with the A.
 * While the A plays its last round before the pause, the B and the C go on as
 * usual, except once that round was played to the end and a match of it was
 * reopened during the night (round no longer complete, pausedAt null): the
 * pause was reached, so no draw of the B or the C happens until the resume,
 * even after a score of the B or the C corrected meanwhile. A draw that was
 * already waiting before the action stays held too.
 */
export function autoAdvance(tx: Transaction, ctx: DrawContext): void {
  const cfg = tx.state.tournament.config;
  for (let guard = 0; guard < 6; guard++) {
    if (pausedAt(tx.state)) return;
    const pending = pausePending(tx.state);
    const reached = pending && pauseReachedBefore(tx.state);
    let drew = false;
    const mainStarted = Object.values(tx.state.rounds).some((r) => r.bracket === "main");
    if (cfg.autoNextRound && mainStarted && canDrawNext(tx.state, "main")) {
      drawNext(tx, { ...ctx, seed: `${ctx.seed}:auto${guard}` }, "main");
      drew = true;
    }
    // The B and the C follow automatically. Their first draw waits for the
    // table when teams enter on their own (« opt_in »: entries are collected first).
    for (const [bracket, tag] of [["consolation", "autoc"], ["consolation_c", "autocc"]] as const) {
      const started = roundsOf(tx.state, bracket).length > 0;
      const auto = started ? cfg.autoNextRound : bracketSettings(tx.state, bracket).entry === "auto";
      if (pending && (reached || canDrawNext(tx.base, bracket))) continue;
      if (auto && canDrawNext(tx.state, bracket)) {
        drawNext(tx, { ...ctx, seed: `${ctx.seed}:${tag}${guard}` }, bracket);
        drew = true;
      }
    }
    if (!drew) return;
  }
}

/** Updates round statuses after results changed. */
export function refreshRounds(tx: Transaction): void {
  for (const r of Object.values(tx.state.rounds)) {
    const ms = matchesOfRound(tx.state, r.id);
    if (ms.length === 0) continue;
    const complete = ms.every(isFinished);
    if (complete && r.status !== "finished") tx.update("round", r.id, { status: "finished" });
    else if (!complete && r.status === "finished") tx.update("round", r.id, { status: "drawn" });
  }
}

/** Progression after a match result was set or changed. */
export function afterResult(tx: Transaction, ctx: EngineContext, matchId: string): void {
  const m = tx.state.matches[matchId];
  if (!m) return;
  const round = tx.state.rounds[m.roundId]!;
  if (isFixedTree(tx.state, round) && isFinished(m)) propagateFixed(tx, m.id, ctx);
  if (round.phase === "pool" && m.pool) gslProgress(tx, ctx, m.pool);
}

/** Every match decided after `m` that involves one of `teams` (other phases, later rounds). */
export function laterMatchesWith(state: EngineState, m: Match, teams: string[]): Match[] {
  const round = state.rounds[m.roundId]!;
  const set = new Set(teams);
  return Object.values(state.matches).filter((x) => {
    if (x.id === m.id) return false;
    const r = state.rounds[x.roundId]!;
    if (compareRounds(r, round) <= 0) return false;
    // The parent chain of a fixed tree is handled by propagation.
    if (isFixedTree(state, round) && r.bracket === round.bracket && r.phase === round.phase) return false;
    // Round-robin pools: every pool match exists from the start.
    if (round.phase === "pool" && r.phase === "pool" && !isGslPool(state, m.pool ?? "")) return false;
    if (["swiss", "league", "melee"].includes(round.phase)) return false;
    return [...x.sideA, ...x.sideB].some((id) => set.has(id));
  });
}

const UNPLAYED: ReadonlySet<Match["status"]> = new Set(["pending", "waiting_venue", "ready"]);

/**
 * Applies a change of winner to what came after: in later, unplayed matches
 * the old winner and the old loser swap places (next round, consolation…).
 */
export function swapInLaterMatches(tx: Transaction, m: Match, oldWinners: string[], oldLosers: string[]): void {
  if (oldWinners.length !== oldLosers.length) return;
  const later = laterMatchesWith(tx.state, m, [...oldWinners, ...oldLosers]);
  const played = later.find((x) => !UNPLAYED.has(x.status) && !isWalkover(x));
  if (played) fail("NEXT_MATCH_PLAYED", { match: played.position });
  const map = new Map<string, string>();
  oldWinners.forEach((w, i) => {
    map.set(w, oldLosers[i]!);
    map.set(oldLosers[i]!, w);
  });
  for (const x of later) {
    tx.update("match", x.id, {
      sideA: x.sideA.map((id) => map.get(id) ?? id),
      sideB: x.sideB.map((id) => map.get(id) ?? id),
    });
  }
}

/**
 * A correction to or from « forfait des deux équipes » changes how many teams
 * go through: nothing can be swapped. Refused while what came after already
 * used the old result (next round of a new-draw bracket, consolation, other
 * phase). A fixed tree is handled by its own propagation.
 */
export function assertNothingDrawnAfter(state: EngineState, m: Match): void {
  const round = state.rounds[m.roundId]!;
  const nextRoundDrawn =
    (round.phase === "elimination" || round.phase === "final") &&
    !isFixedTree(state, round) &&
    Object.values(state.rounds).some((r) => r.bracket === round.bracket && r.phase === round.phase && r.number > round.number);
  if (nextRoundDrawn || laterMatchesWith(state, m, [...m.sideA, ...m.sideB]).length) fail("NEXT_ROUND_DRAWN");
}

export function qualificationSnapshot(state: EngineState): string {
  if (state.tournament.config.format !== "pools_then_bracket") return "";
  return qualifiers(state)
    .map((q) => `${q.pool}${q.place}:${q.id}`)
    .join(",");
}

export { unpropagateFixed, hasResult, lastRound, eliminationRanking, deleteRound };
