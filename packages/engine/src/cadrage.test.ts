import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { applyChanges, invertChanges } from "./tx";
import { cadragePairing } from "./pairing";
import { canDrawNext, eliminationDrawPlan, qualifiers } from "./formats";
import { isOfficeBye, isPowerOfTwo, largestPowerOfTwo, matchesOfRound, roundLabel, roundsOf } from "./queries";
import { createIdGenerator, createRng } from "./rng";
import { computeStats } from "./standings";
import { exec, makeState, PLAYABLE_STATUSES, playToEnd, randomScore, resetOps } from "./test-helpers";
import type { EngineState, Phase } from "./types";

/** Explicit time limit for the 129 / 200 / 256 / 300-team runs (slow on a busy machine). */
const HEAVY = 30_000;

/** Lot 2, M2: single draw rule of an elimination bracket, with a « cadrage ». */

beforeEach(() => resetOps());

/** One line per round: games, exempt, « d'office », label key. */
function profile(s: EngineState, phase: Phase): string[] {
  return roundsOf(s, "main", phase).map((r) => {
    const ms = matchesOfRound(s, r.id);
    const office = ms.filter((m) => isOfficeBye(s, m)).length;
    const exempt = ms.filter((m) => m.status === "bye").length - office;
    const games = ms.length - office - exempt;
    const label = roundLabel(s, r);
    return `${games}p${exempt ? `+${exempt}ex` : ""}${office ? `+${office}off` : ""} ${label.key}${"n" in label ? label.n : ""}`;
  });
}

const noB = { consolation: { enabled: false } };

function playElimination(n: number, k: 1 | 2): EngineState {
  const s = makeState({ teams: n, config: { bracketMode: "redraw", cadrage: { afterRound: k }, ...noB } });
  return playToEnd(s, `elim-${n}-${k}`);
}

describe("eliminationDrawPlan", () => {
  it("before the cadrage point: full draw, one exempt when odd", () => {
    expect(eliminationDrawPlan(13, 0, 1, false)).toEqual({ matches: 6, office: 0, exempt: 1, kind: "partie" });
    expect(eliminationDrawPlan(50, 1, 2, false)).toEqual({ matches: 25, office: 0, exempt: 0, kind: "partie" });
  });
  it("at the cadrage point: T − P games, 2P − T « d'office »", () => {
    // Cadrage applied directly (table of the rules): T → games, office, left.
    const table: [number, number, number, number][] = [
      [5, 1, 3, 4],
      [7, 3, 1, 4],
      [13, 5, 3, 8],
      [33, 1, 31, 32],
      [100, 36, 28, 64],
      [200, 72, 56, 128],
    ];
    for (const [T, games, office, left] of table) {
      const plan = eliminationDrawPlan(T, 0, 1, true);
      expect(plan).toEqual({ matches: games, office, exempt: 0, kind: "cadrage" });
      expect(games + office).toBe(left);
      expect(eliminationDrawPlan(T, 1, 1, false)).toEqual(plan);
    }
    expect(eliminationDrawPlan(16, 1, 1, false)).toEqual({ matches: 8, office: 0, exempt: 0, kind: "partie" });
  });
  it("safety net after the cadrage: 7 winners give 3 games and 1 « d'office », not a new cadrage", () => {
    expect(eliminationDrawPlan(7, 3, 1, false)).toEqual({ matches: 3, office: 1, exempt: 0, kind: "partie" });
  });
  it("largestPowerOfTwo", () => {
    expect([1, 2, 3, 7, 8, 9, 100, 129, 256].map(largestPowerOfTwo)).toEqual([1, 2, 2, 4, 8, 8, 64, 128, 256]);
  });
});

describe("cadragePairing", () => {
  it("2(T − P) teams play, the others are « d'office », everybody once", () => {
    const teams = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, club: null, seed: null }));
    const { pairs, office } = cadragePairing(teams, 8, createRng("c"), { avoidSameClub: false });
    expect(pairs.length).toBe(5);
    expect(office.length).toBe(3);
    expect(new Set([...pairs.flat(), ...office]).size).toBe(13);
  });
  it("same club avoided when a club holds most of the players drawn", () => {
    for (let i = 0; i < 30; i++) {
      // 5 teams: 1 game; 4 of them from the same club.
      const teams = Array.from({ length: 5 }, (_, j) => ({ id: `t${j}`, club: j < 4 ? "X" : "Y", seed: null }));
      const { pairs } = cadragePairing(teams, 4, createRng(`c${i}`), { avoidSameClub: true });
      expect(pairs[0]!.sort()).toContain("t4");
    }
  });
});

describe("elimination without pools: rounds of the reference table", () => {
  const cases: [number, 1 | 2, string[]][] = [
    [2, 1, ["1p final"]],
    [2, 2, ["1p final"]],
    [3, 1, ["1p+1ex partie1", "1p final"]],
    [3, 2, ["1p+1ex partie1", "1p final"]],
    [5, 1, ["2p+1ex partie1", "1p+1off cadrage", "1p final"]],
    [5, 2, ["2p+1ex partie1", "1p+1ex partie2", "1p final"]],
    [7, 1, ["3p+1ex partie1", "2p semifinal", "1p final"]],
    [7, 2, ["3p+1ex partie1", "2p partie2", "1p final"]],
    [13, 1, ["6p+1ex partie1", "3p+1off cadrage", "2p semifinal", "1p final"]],
    [13, 2, ["6p+1ex partie1", "3p+1ex partie2", "2p semifinal", "1p final"]],
    [33, 1, ["16p+1ex partie1", "1p+15off cadrage", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [33, 2, ["16p+1ex partie1", "8p+1ex partie2", "1p+7off cadrage", "4p quarterfinal", "2p semifinal", "1p final"]],
    [100, 1, ["50p partie1", "18p+14off cadrage", "16p round_of_32", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [100, 2, ["50p partie1", "25p partie2", "9p+7off cadrage", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [129, 1, ["64p+1ex partie1", "1p+63off cadrage", "32p round_of_64", "16p round_of_32", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [129, 2, ["64p+1ex partie1", "32p+1ex partie2", "1p+31off cadrage", "16p round_of_32", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [200, 1, ["100p partie1", "36p+28off cadrage", "32p round_of_64", "16p round_of_32", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
    [200, 2, ["100p partie1", "50p partie2", "18p+14off cadrage", "16p round_of_32", "8p round_of_16", "4p quarterfinal", "2p semifinal", "1p final"]],
  ];
  for (const [n, k, expected] of cases) {
    it(`${n} teams, cadrage after game ${k}`, () => {
      const s = playElimination(n, k);
      expect(profile(s, "elimination")).toEqual(expected);
      expect(s.tournament.status).toBe("finished");
    }, n >= 129 ? HEAVY : undefined);
  }

  it("256 teams (power of two): no exempt, no cadrage, 8 rounds", () => {
    for (const k of [1, 2] as const) {
      const p = profile(playElimination(256, k), "elimination");
      expect(p.length).toBe(8);
      // 128 games: 1re partie; then by places: 64 → 32 → … → 1.
      expect(p.slice(1)).toEqual([
        k === 1 ? "64p round_of_128" : "64p partie2",
        "32p round_of_64",
        "16p round_of_32",
        "8p round_of_16",
        "4p quarterfinal",
        "2p semifinal",
        "1p final",
      ]);
      expect(p.every((x) => !x.includes("ex") && !x.includes("off"))).toBe(true);
      expect(p[p.length - 1]).toBe("1p final");
    }
  }, HEAVY);

  it("after the cadrage, every round starts with a power of two (2 … 300 teams, k = 1 and 2)", () => {
    for (const k of [1, 2] as const) {
      for (const n of [2, 3, 4, 5, 6, 9, 11, 17, 23, 31, 47, 63, 65, 77, 129, 300]) {
        resetOps();
        const s = playElimination(n, k);
        roundsOf(s, "main", "elimination").forEach((r) => {
          const ms = matchesOfRound(s, r.id);
          const teams = ms.reduce((t, m) => t + m.sideA.length + m.sideB.length, 0);
          if (r.number > k + 1) expect(isPowerOfTwo(teams)).toBe(true);
          if (r.number > k) expect(ms.some((m) => m.status === "bye" && !isOfficeBye(s, m))).toBe(false);
        });
        expect(s.tournament.status).toBe("finished");
      }
    }
  }, HEAVY);
});

describe("pools then final phase (pétanque: new draw, cadrage right after the pools)", () => {
  const cases: [number, number, string][] = [
    [16, 8, "4p quarterfinal"],
    [20, 10, "2p+6off cadrage"],
    [33, 18, "2p+14off cadrage"],
    [100, 50, "18p+14off cadrage"],
    [200, 100, "36p+28off cadrage"],
  ];
  for (const [n, qualified, first] of cases) {
    it(`${n} teams: ${qualified} qualified, first final round ${first}`, () => {
      for (const k of [1, 2] as const) {
        resetOps();
        let s = makeState({ teams: n, config: { format: "pools_then_bracket", bracketMode: "redraw", cadrage: { afterRound: k }, ...noB } });
        s = playToEnd(s, `pools-${n}`);
        expect(qualifiers(s).length).toBe(qualified);
        const p = profile(s, "final");
        expect(p[0]).toBe(first);
        expect(p[p.length - 1]).toBe("1p final");
        // No pool-mate met in the first final round.
        const poolOf = new Map<string, string>();
        for (const m of Object.values(s.matches)) if (m.pool) for (const id of [...m.sideA, ...m.sideB]) poolOf.set(id, m.pool);
        const r1 = roundsOf(s, "main", "final")[0]!;
        for (const m of matchesOfRound(s, r1.id)) if (m.sideB.length) expect(poolOf.get(m.sideA[0]!)).not.toBe(poolOf.get(m.sideB[0]!));
        // The final phase is a new draw each round, not a fixed tree.
        expect(roundsOf(s, "main", "final").every((r) => r.seed !== null)).toBe(true);
        expect(s.tournament.status).toBe("finished");
      }
    }, n >= 129 ? HEAVY : undefined);
  }

  it("the fixed tree stays available (football): seeded tree drawn at once", () => {
    let s = makeState({ teams: 12, sport: "football", config: { format: "pools_then_bracket", ...noB } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "pools" });
    s = playToEnd(s, "foot");
    const final = roundsOf(s, "main", "final");
    expect(final.some((r) => r.seed === null)).toBe(true);
    expect(s.tournament.status).toBe("finished");
  });
});

describe("safety net after the cadrage", () => {
  it("a double forfeit leaves 7 winners: 3 games and 1 « d'office », named quarter-final", () => {
    let s = makeState({ teams: 33, config: { bracketMode: "redraw", autoNextRound: false, ...noB } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "d" });
    const rng = createRng("dbl");
    const playRound = (number: number, both = false) => {
      const r = roundsOf(s, "main", "elimination").find((x) => x.number === number)!;
      matchesOfRound(s, r.id)
        .filter((m) => PLAYABLE_STATUSES.has(m.status))
        .forEach((m, i) => {
          s = both && i === 0 ? exec(s, { type: "match.forfeit", matchId: m.id, side: "both" }) : exec(s, { type: "match.score", matchId: m.id, ...randomScore(s, () => rng.next(), true) });
        });
    };
    playRound(1);
    s = exec(s, { type: "round.draw", bracket: "main", seed: "d2" });
    playRound(2);
    s = exec(s, { type: "round.draw", bracket: "main", seed: "d3" });
    playRound(3, true);
    expect(canDrawNext(s, "main")).toBe(true);
    s = exec(s, { type: "round.draw", bracket: "main", seed: "d4" });
    expect(profile(s, "elimination")).toEqual(["16p+1ex partie1", "1p+15off cadrage", "8p round_of_16", "3p+1off quarterfinal"]);
  });
});

describe("scores of an exempt and of a place « d'office »", () => {
  it("exempt before the cadrage: 13-7 (not the forfeit 13-0); « d'office »: a win without points", () => {
    let s = makeState({ teams: 13, config: { bracketMode: "redraw", autoNextRound: false, ...noB } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "x" });
    const r1 = roundsOf(s, "main", "elimination")[0]!;
    const exempt = matchesOfRound(s, r1.id).find((m) => m.status === "bye")!;
    const rng = createRng("sc");
    for (const m of matchesOfRound(s, r1.id).filter((x) => PLAYABLE_STATUSES.has(x.status)))
      s = exec(s, { type: "match.score", matchId: m.id, ...randomScore(s, () => rng.next(), true) });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "y" });
    const r2 = roundsOf(s, "main", "elimination")[1]!;
    const office = matchesOfRound(s, r2.id).find((m) => m.status === "bye")!;
    expect(isOfficeBye(s, exempt)).toBe(false);
    expect(isOfficeBye(s, office)).toBe(true);
    const e = computeStats(s, exempt.sideA, [exempt]).get(exempt.sideA[0]!)!;
    expect([e.wins, e.pointsFor, e.pointsAgainst]).toEqual([1, 13, 7]);
    const o = computeStats(s, office.sideA, [office]).get(office.sideA[0]!)!;
    expect([o.wins, o.pointsFor, o.pointsAgainst]).toEqual([1, 0, 0]);
  });
});

describe("cadrage draw: same result everywhere, undo restores exactly (M2, tester)", () => {
  it("13 teams: the cadrage draw (3 games + 1 « d'office ») is identical on two devices and undone exactly", () => {
    let s = makeState({ teams: 13, config: { bracketMode: "redraw", autoNextRound: false, ...noB } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "u1" });
    const rng = createRng("undo");
    const r1 = roundsOf(s, "main", "elimination")[0]!;
    for (const m of matchesOfRound(s, r1.id).filter((x) => PLAYABLE_STATUSES.has(x.status)))
      s = exec(s, { type: "match.score", matchId: m.id, ...randomScore(s, () => rng.next(), true) });
    const ctx = { now: "2026-10-12T15:00:00.000Z", newId: createIdGenerator("cad"), seed: "cad" };
    const a = applyCommand(s, { type: "round.draw", bracket: "main", seed: "u2" }, ctx);
    const b = applyCommand(s, { type: "round.draw", bracket: "main", seed: "u2" }, { ...ctx, newId: createIdGenerator("cad") });
    expect(b.state).toEqual(a.state);
    expect(profile(a.state, "elimination")).toEqual(["6p+1ex partie1", "3p+1off cadrage"]);
    expect(applyChanges(a.state, invertChanges(a.changes))).toEqual(s);
  });
});

describe("pools then final phase: other sizes of the reference list", () => {
  for (const n of [13, 129, 256]) {
    it(`${n} teams: after the cadrage every final round starts with a power of two`, () => {
      resetOps();
      let s = makeState({ teams: n, config: { format: "pools_then_bracket", bracketMode: "redraw", ...noB } });
      s = playToEnd(s, `pools-x-${n}`);
      const q = qualifiers(s).length;
      const P = largestPowerOfTwo(q);
      const p = profile(s, "final");
      expect(p[0]).toBe(q === P ? `${q / 2}p ${p[0]!.split(" ")[1]}` : `${q - P}p+${2 * P - q}off cadrage`);
      roundsOf(s, "main", "final").slice(1).forEach((r) => {
        const teams = matchesOfRound(s, r.id).reduce((t, m) => t + m.sideA.length + m.sideB.length, 0);
        expect(isPowerOfTwo(teams)).toBe(true);
      });
      expect(p[p.length - 1]).toBe("1p final");
      expect(s.tournament.status).toBe("finished");
    }, n >= 129 ? HEAVY : undefined);
  }
});
