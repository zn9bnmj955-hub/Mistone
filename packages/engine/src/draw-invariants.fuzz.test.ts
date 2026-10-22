import { describe, expect, it } from "vitest";
import { applyCommand, type Command } from "./commands";
import { EngineError } from "./errors";
import { canDrawNext, isPauseHeld, pausedAt } from "./formats";
import { isAfterCadragePoint, isOfficeBye, isPowerOfTwo, matchesOfRound, roundLabel, roundsOf } from "./queries";
import { createIdGenerator, createRng, type Rng } from "./rng";
import { makeState, PLAYABLE_STATUSES, randomScore, type TestConfig } from "./test-helpers";
import { applyChanges, invertChanges } from "./tx";
import type { Bracket, EngineState, PauseRule } from "./types";

/**
 * Lot 2, M8: massive random test of the draw rules (docs/LOT2-PLAN.md, « Règles retenues »).
 * Random pétanque tournaments, 2 to 300 teams, k = 1 or 2, with or without pools, B and C on or off,
 * absent teams, random forfeits (one or both sides), withdrawals and a two-day pause, played to the end.
 * During the pause, night corrections: a match of the A's last round reopened, then started, flagged,
 * put on a pitch and scored again, and B or C results corrected; no round is drawn meanwhile except
 * by the resume or a manual draw.
 * Every action is undone once to prove the inverse restores the previous state exactly.
 * FUZZ_SEEDS overrides the number of seeds (1 500 by default, about 25 s).
 */

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 1500);
const BRACKETS: Bracket[] = ["main", "consolation", "consolation_c"];

/** Deterministic, key-order independent serialization (undefined fields dropped, as toEqual does). */
function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(",")}}`;
}

const COLLECTIONS = ["teams", "players", "venues", "rounds", "matches", "teamSecrets", "registrations"] as const;

/**
 * Same state, compared fast: commands share every untouched row with the state they
 * receive, so rows are compared by reference first and serialized only when they differ.
 */
function expectSameState(actual: EngineState, expected: EngineState, label: string) {
  // Plain comparisons (expect() only on a difference): this runs after every action.
  const same = (a: unknown, e: unknown, what: string) => {
    if (a !== e && canon(a) !== canon(e)) expect(canon(a), `${label} — ${what}`).toBe(canon(e));
  };
  same(actual.tournament, expected.tournament, "tournament");
  same(actual.rules, expected.rules, "rules");
  for (const c of COLLECTIONS) {
    const a = actual[c] as Record<string, unknown>;
    const e = expected[c] as Record<string, unknown>;
    if (a === e) continue;
    if (Object.keys(a).length !== Object.keys(e).length) expect(Object.keys(a).sort(), `${label} — ${c}`).toEqual(Object.keys(e).sort());
    for (const id in e) same(a[id], e[id], `${c}.${id}`);
  }
}

type Scenario = { teams: number; venues: number; config: TestConfig; absent: number; label: string };

function scenario(seed: number): Scenario {
  const rng = createRng(`m8-scenario-${seed}`);
  // Time budget (< 30 s): 1 seed in 200 is big (129 to 300 teams), 1 in 20 medium (49 to 128), the others 2 to 48.
  const teams = seed % 200 === 0 ? 129 + rng.int(172) : seed % 20 === 10 ? 49 + rng.int(80) : 2 + rng.int(47);
  const pools = teams >= 6 && rng.next() < 0.35;
  const k = (1 + rng.int(2)) as 1 | 2;
  const b = rng.next() < 0.6;
  const c = b && rng.next() < 0.5;
  const pauses: PauseRule[] = [null, null, { before: { remaining: 16 } }, { before: { remaining: 8 } }, { afterRound: 1 }];
  if (pools) pauses.push("afterPools");
  const pause = rng.pick(pauses);
  const config: TestConfig = {
    format: pools ? "pools_then_bracket" : "single_elimination",
    bracketMode: "redraw",
    cadrage: { afterRound: k },
    consolation: { enabled: b, entry: "auto" },
    consolationC: { enabled: c, entry: "auto" },
    pause,
  };
  const absent = teams > 4 ? rng.int(Math.max(1, Math.floor(teams / 10))) : 0;
  const label = `seed ${seed}: ${teams} teams (${absent} absent), ${pools ? "pools" : "no pools"}, k=${k}, B=${b}, C=${c}, pause=${JSON.stringify(pause)}`;
  // From a third of the terrains needed (long queues) to all of them.
  const venues = Math.max(1, Math.round((teams / 2) * (0.3 + 0.7 * rng.next())));
  return { teams, venues, config, absent, label };
}

const fail = (message: string): never => expect.fail(message);

/** Draw rules that must hold at any time (M2 rules 1-3). */
function checkDrawInvariants(s: EngineState, label: string) {
  for (const bracket of BRACKETS) {
    const exempted = new Set<string>();
    for (const r of roundsOf(s, bracket)) {
      if (r.phase !== "elimination" && r.phase !== "final") continue;
      const ms = matchesOfRound(s, r.id);
      if (isAfterCadragePoint(s, r)) {
        // Every game or « d'office » place gives one team to the next round: always a power of two.
        if (!isPowerOfTwo(ms.length)) fail(`${label} — ${bracket} round ${r.number} (${r.phase}) leaves ${ms.length} places`);
        if (ms.some((m) => m.status === "bye" && !isOfficeBye(s, m))) fail(`${label} — ${bracket} round ${r.number}: exempt after the cadrage`);
      } else {
        const exempts = ms.filter((m) => m.status === "bye");
        if (exempts.length > 1) fail(`${label} — ${bracket} round ${r.number}: ${exempts.length} exempts`);
        for (const m of exempts) {
          const team = m.sideA[0] ?? m.sideB[0]!;
          // At most 2 rounds before the cadrage, each with at least 3 teams when one is exempt: a repeat is always avoidable.
          if (exempted.has(team)) fail(`${label} — ${bracket}: ${team} exempt twice`);
          exempted.add(team);
        }
      }
    }
  }
}

function play(seed: number) {
  const sc = scenario(seed);
  const rng: Rng = createRng(`m8-play-${seed}`);
  let s = makeState({ teams: sc.teams, venues: sc.venues, clubs: (i) => `club-${i % 5}`, config: sc.config });
  // Absent at check-in: excluded from the draw, the cadrage absorbs the gap.
  const ids = Object.keys(s.teams);
  for (let i = 0; i < sc.absent; i++) s.teams[ids[rng.int(ids.length)]!]!.status = "registered";
  let op = 0;
  const seen = { actions: 0, refused: 0, cadrage: 0, office: 0, exempt: 0, doubleForfeit: 0, withdrawn: 0, resume: 0, pools: 0, bracketC: 0, nightReopen: 0 };
  // Two-day pause: true from the moment the A is held until the resume or a manual draw of the A
  // (tracked here, independently of the engine's own pause rule).
  let paused = false;
  let nights = 0;
  const run = (cmd: Command): boolean => {
    op++;
    const now = new Date(Date.UTC(2026, 9, 12, 12, 0) + op * 60_000).toISOString();
    let res;
    try {
      res = applyCommand(s, cmd, { now, newId: createIdGenerator(`op-${op}`), seed: `seed-${seed}-${op}` });
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      seen.refused++; // refusals are fine (e.g. a withdrawal the rules do not allow)
      return false;
    }
    // Undoing the action gives back the previous state exactly.
    expectSameState(applyChanges(res.state, invertChanges(res.changes)), s, `${sc.label} — undo of ${cmd.type} (op ${op})`);
    // A withdrawal or a double forfeit changes the number of teams left: the pause point may then
    // rightly move or vanish (e.g. one team left, the A is over), so the draws that follow are expected.
    const resizes = cmd.type === "team.setStatus" || (cmd.type === "match.forfeit" && cmd.side === "both");
    if (paused && !resizes && cmd.type !== "tournament.resume" && cmd.type !== "round.draw" && res.changes.some((c) => c.entity === "round" && c.op === "create")) {
      fail(`${sc.label} — ${cmd.type} (op ${op}) drew a round during the pause`);
    }
    if (cmd.type === "tournament.resume" || (cmd.type === "round.draw" && cmd.bracket === "main") || (resizes && !pausedAt(res.state))) paused = false;
    if (pausedAt(res.state)) paused = true;
    // The scoring table shows « Concours en pause » (isPauseHeld) while the pause holds, night corrections included.
    // Known gap (it.fails in pause-night.test.ts): pools with a « before R teams » pause falling right after the pools.
    const knownGap = sc.config.format === "pools_then_bracket" && sc.config.pause !== "afterPools" && roundsOf(res.state, "main", "final").length === 0;
    if (paused && !knownGap && !isPauseHeld(res.state)) fail(`${sc.label} — ${cmd.type} (op ${op}): the pause holds but isPauseHeld is false`);
    if (cmd.type === "match.reopen" && paused) seen.nightReopen++;
    seen.actions++;
    if (cmd.type === "match.forfeit" && cmd.side === "both") seen.doubleForfeit++;
    if (cmd.type === "team.setStatus") seen.withdrawn++;
    if (cmd.type === "tournament.resume") seen.resume++;
    s = res.state;
    if (res.changes.some((c) => c.entity === "round" && c.op === "create")) checkDrawInvariants(s, sc.label);
    return true;
  };

  /**
   * A result of the last round of `bracket` (or of the pools), reopened; refused when a later round is built on it.
   * In the A, never a double forfeit: scored again it would add a team, and the pause point (« before R teams »)
   * may then legitimately move to a later round, so draws would rightly follow.
   */
  const reopenLast = (bracket: Bracket): string | null => {
    const rounds = roundsOf(s, bracket);
    const last = rounds[rounds.length - 1];
    if (!last) return null;
    // Pools: any pool round (the pools are played side by side), else the last round.
    const inScope = (roundId: string) => (last.phase === "pool" ? s.rounds[roundId]!.bracket === bracket && s.rounds[roundId]!.phase === "pool" : roundId === last.id);
    const done = Object.values(s.matches).filter((m) => inScope(m.roundId) && (m.status === "done" || m.status === "forfeit") && m.sideB.length > 0 && (bracket !== "main" || m.winner !== null));
    if (!done.length) return null;
    const m = rng.pick(done);
    return run({ type: "match.reopen", matchId: m.id }) ? m.id : null;
  };
  const nightCorrections = () => {
    const a = reopenLast("main");
    if (a) {
      const roll = rng.next();
      if (roll < 0.25) run({ type: "match.start", matchId: a });
      else if (roll < 0.4) run({ type: "match.setFlag", matchId: a, flag: "disputed" });
      else if (roll < 0.5) run({ type: "match.setFlag", matchId: a, flag: "score_submitted" });
      else if (roll < 0.65) {
        const free = Object.values(s.venues).filter((v) => v.available && !Object.values(s.matches).some((x) => x.venueId === v.id && x.status !== "done" && x.status !== "forfeit"));
        if (free.length) run({ type: "match.setVenue", matchId: a, venueId: rng.pick(free).id });
      }
      if (rng.next() < 0.3) run({ type: "match.setFlag", matchId: a, flag: "clear" });
    }
    // A result of the B or the C corrected meanwhile (reopened, then scored again).
    for (const b of ["consolation", "consolation_c"] as const) {
      if (rng.next() < 0.5) continue;
      const m = reopenLast(b);
      if (m) run({ type: "match.score", matchId: m, ...randomScore(s, () => rng.next(), true) });
    }
    // The A's reopened match is scored again by the main loop (still during the pause).
  };

  run({ type: "round.draw", bracket: "main", seed: `${seed}-first` });
  for (let step = 0; step < 20_000; step++) {
    const playable = Object.values(s.matches)
      .filter((m) => PLAYABLE_STATUSES.has(m.status) || m.status === "disputed" || m.status === "score_submitted") // flagged at night: the table scores it
      .sort((a, b) => (a.queuedAt ?? "").localeCompare(b.queuedAt ?? "") || a.position - b.position);
    const m = playable.length ? playable[rng.next() < 0.8 ? 0 : rng.int(playable.length)]! : null;
    const roll = rng.next();
    if (m) {
      if (roll < 0.04) run({ type: "match.forfeit", matchId: m.id, side: "both" });
      else if (roll < 0.1) run({ type: "match.forfeit", matchId: m.id, side: rng.next() < 0.5 ? "A" : "B" });
      else run({ type: "match.score", matchId: m.id, ...randomScore(s, () => rng.next(), true) });
      continue;
    }
    // Between two rounds: sometimes a team withdraws (refused or not, the rules must hold).
    if (roll < 0.12) {
      const active = Object.values(s.teams).filter((t) => t.status === "checked_in");
      if (active.length) run({ type: "team.setStatus", teamId: rng.pick(active).id, status: "withdrawn" });
    }
    if (pausedAt(s) && nights < 2 && rng.next() < 0.5) {
      // Night corrections: none of them may draw anything (checked in run).
      nights++;
      nightCorrections();
      continue;
    }
    if (pausedAt(s) && rng.next() < 0.5) {
      nights = 0;
      run({ type: "tournament.resume", seed: `${seed}-resume-${step}` });
      continue;
    }
    const next = BRACKETS.find((b) => canDrawNext(s, b));
    // A withdrawal may have let a held draw happen (e.g. the A is over): play it.
    if (!next && Object.values(s.matches).some((x) => PLAYABLE_STATUSES.has(x.status))) continue;
    if (!next) break;
    if (!run({ type: "round.draw", bracket: next, seed: `${seed}-${next}-${step}` })) throw new Error(`${sc.label} — draw of ${next} refused`);
  }
  checkDrawInvariants(s, sc.label);
  expect(s.tournament.status, `${sc.label} — not finished`).toBe("finished");
  for (const r of Object.values(s.rounds)) {
    if (roundLabel(s, r).key === "cadrage") seen.cadrage++;
    if (r.phase === "pool") seen.pools++;
    if (r.bracket === "consolation_c") seen.bracketC++;
  }
  for (const m of Object.values(s.matches)) if (m.status === "bye") seen[isOfficeBye(s, m) ? "office" : "exempt"]++;
  return seen;
}

describe("draw invariants on random tournaments (M8)", () => {
  it(`${SEEDS} random tournaments: power of two after the cadrage, one exempt at most, never the same, always finished, every action undoable`, () => {
    const total: Record<string, number> = {};
    for (let seed = 0; seed < SEEDS; seed++) {
      try {
        for (const [k, v] of Object.entries(play(seed))) total[k] = (total[k] ?? 0) + v;
      } catch (e) {
        const { label } = scenario(seed);
        const message = (e as Error).message;
        throw new Error(message.includes(label) ? message : `${label}: ${message}`, { cause: e });
      }
    }
    // Every situation of the rules was met many times (not a test that silently plays nothing).
    for (const k of ["cadrage", "office", "exempt", "doubleForfeit", "withdrawn", "resume", "pools", "bracketC", "nightReopen"]) expect(total[k], k).toBeGreaterThan(SEEDS / 50);
    expect(total.actions).toBeGreaterThan(SEEDS * 10);
    if (process.env.FUZZ_STATS) console.log(total);
  }, 120_000);
});
