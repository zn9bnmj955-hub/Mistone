import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { canDrawNext, pausedAt } from "./formats";
import { roundsOf } from "./queries";
import { createIdGenerator } from "./rng";
import { exec, makeState, PLAYABLE_STATUSES, resetOps, type TestConfig } from "./test-helpers";
import { applyChanges, invertChanges } from "./tx";
import type { Bracket, EngineState, Match } from "./types";

/**
 * Lot 2, M5 (testeur, après daf6d71) : cas limites de la règle « pause atteinte » (pauseReachedBefore) —
 * corrections de nuit sur un match rouvert puis relancé ou signalé, poules « afterPools », annulations,
 * forfait rouvert, cadrage, et le jour 1 (avant que la pause soit atteinte).
 */

beforeEach(() => resetOps());

const ABC: TestConfig = { bracketMode: "redraw", consolation: { enabled: true, entry: "auto" }, consolationC: { enabled: true, entry: "auto" } };
const count = (s: EngineState, b: Bracket) => roundsOf(s, b).length;
const counts = (s: EngineState) => ({ main: count(s, "main"), b: count(s, "consolation"), c: count(s, "consolation_c") });

/** Scores every playable match (side A wins) except `skip`, until none is left. */
function playAll(start: EngineState, skip: ReadonlySet<string> = new Set()): EngineState {
  let s = start;
  for (let i = 0; i < 2000; i++) {
    const m = Object.values(s.matches)
      .filter((x) => PLAYABLE_STATUSES.has(x.status) && !skip.has(x.id))
      .sort((a, b) => (a.queuedAt ?? "").localeCompare(b.queuedAt ?? "") || a.position - b.position)[0];
    if (!m) return s;
    s = exec(s, { type: "match.score", matchId: m.id, scoreA: 13, scoreB: 5 });
  }
  throw new Error("too many matches");
}

const lastMatchOf = (s: EngineState, b: Bracket, pred: (m: Match) => boolean = () => true) => {
  const rs = roundsOf(s, b);
  const last = rs[rs.length - 1]!;
  return Object.values(s.matches).find((x) => x.roundId === last.id && x.sideB.length > 0 && pred(x))!;
};

/** Day 1 of a 64-team tournament with A, B and C, held before the 1/8. */
function dayOne(): { s: EngineState; held: ReturnType<typeof counts> } {
  let s = exec(makeState({ teams: 64, config: { ...ABC, pause: { before: { remaining: 16 } } } }), { type: "round.draw", bracket: "main", seed: "d1" });
  s = playAll(s);
  expect(pausedAt(s)).toEqual({ phase: "elimination", round: 3, teams: 16 });
  return { s, held: counts(s) };
}

/** Reopens a B match of its last round, then scores it again: the B's draw is no longer « possible before the action ». */
function correctB(s: EngineState): EngineState {
  const bM = lastMatchOf(s, "consolation", (x) => x.status === "done");
  s = exec(s, { type: "match.reopen", matchId: bM.id });
  return exec(s, { type: "match.score", matchId: bM.id, scoreA: 13, scoreB: 11 });
}

describe("pause de 2 jours — corrections de nuit, cas limites (testeur, daf6d71)", () => {
  it("un match du A gagné par forfait, rouvert la nuit, puis une correction du B : le B et le C restent tenus", () => {
    const d = dayOne();
    const held = d.held;
    const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
    // Le résultat devient un forfait (startedAt rempli par le forfait lui-même), puis il est rouvert.
    let s = exec(d.s, { type: "match.reopen", matchId: aM.id });
    s = exec(s, { type: "match.forfeit", matchId: aM.id, side: "B" });
    expect(pausedAt(s)).not.toBeNull();
    s = exec(s, { type: "match.reopen", matchId: aM.id });
    expect(s.matches[aM.id]!.startedAt).not.toBeNull();
    s = correctB(s);
    expect(counts(s)).toEqual(held);
  });

  it("un match du A rouvert puis remis sur un terrain (prêt) la nuit, puis une correction du B : le B et le C restent tenus", () => {
    const d = dayOne();
    const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
    let s = exec(d.s, { type: "match.reopen", matchId: aM.id });
    const venue = Object.values(s.venues).find((v) => !Object.values(s.matches).some((m) => m.venueId === v.id && m.status !== "done"))!;
    s = exec(s, { type: "match.setVenue", matchId: aM.id, venueId: venue.id });
    expect(s.matches[aM.id]!.status).toBe("ready");
    s = correctB(s);
    expect(counts(s)).toEqual(d.held);
  });

  // Corrigé : la réouverture est enregistrée sur le tour (statut « live »), elle tient même si le match est relancé.
  it("un match du A rouvert puis relancé (en cours) la nuit, puis une correction du B : le B et le C restent tenus", () => {
    const d = dayOne();
    const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
    let s = exec(d.s, { type: "match.reopen", matchId: aM.id });
    s = exec(s, { type: "match.start", matchId: aM.id });
    expect(s.matches[aM.id]!.status).toBe("playing");
    s = correctB(s);
    expect(counts(s)).toEqual(d.held);
  });

  // Même écart quand le match rouvert du A est marqué « à vérifier » (ou « score envoyé » par un capitaine).
  for (const flag of ["disputed", "score_submitted"] as const) {
    it(`un match du A rouvert puis signalé « ${flag} » la nuit, puis une correction du B : le B et le C restent tenus`, () => {
      const d = dayOne();
      const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
      let s = exec(d.s, { type: "match.reopen", matchId: aM.id });
      s = exec(s, { type: "match.setFlag", matchId: aM.id, flag });
      s = correctB(s);
      expect(counts(s)).toEqual(d.held);
    });
  }

  it("annuler la réouverture de nuit du match du A ramène exactement à l'état en pause", () => {
    const d = dayOne();
    const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
    const r = applyCommand(d.s, { type: "match.reopen", matchId: aM.id }, { now: "2026-10-12T23:00:00.000Z", newId: createIdGenerator("night") });
    const back = applyChanges(r.state, invertChanges(r.changes));
    expect(back).toEqual(d.s);
    expect(pausedAt(back)).toEqual({ phase: "elimination", round: 3, teams: 16 });
  });

  it("annuler la correction du B faite la nuit (match du A rouvert) ne tire rien et garde la pause en attente", () => {
    const d = dayOne();
    const aM = lastMatchOf(d.s, "main", (x) => x.status === "done");
    let s = exec(d.s, { type: "match.reopen", matchId: aM.id });
    const bM = lastMatchOf(s, "consolation", (x) => x.status === "done");
    s = exec(s, { type: "match.reopen", matchId: bM.id });
    const r = applyCommand(s, { type: "match.score", matchId: bM.id, scoreA: 13, scoreB: 11 }, { now: "2026-10-12T23:30:00.000Z", newId: createIdGenerator("nb") });
    expect(counts(r.state)).toEqual(d.held);
    expect(applyChanges(r.state, invertChanges(r.changes))).toEqual(s);
  });

  it("40 équipes (cadrage avant la pause) : un match du cadrage rouvert la nuit puis une correction du B, rien n'est tiré", () => {
    let s = exec(makeState({ teams: 40, config: { ...ABC, pause: { before: { remaining: 16 } } } }), { type: "round.draw", bracket: "main", seed: "c40" });
    s = playAll(s);
    expect(pausedAt(s)?.teams).toBe(16);
    const held = counts(s);
    const aM = lastMatchOf(s, "main", (x) => x.status === "done");
    s = exec(s, { type: "match.reopen", matchId: aM.id });
    s = correctB(s);
    expect(counts(s)).toEqual(held);
    s = exec(s, { type: "match.score", matchId: aM.id, scoreA: 13, scoreB: 4 });
    expect(pausedAt(s)?.teams).toBe(16);
    expect(counts(s)).toEqual(held);
  });

  it("afterPools : un match de poule rouvert la nuit puis ressaisi, la phase finale et le B attendent la reprise ; l'annulation de la reprise ramène la pause", () => {
    const cfg: TestConfig = { format: "pools_then_bracket", bracketMode: "redraw", consolation: { enabled: true, entry: "auto", source: "pool_non_qualified" }, pause: "afterPools" };
    let s = exec(makeState({ teams: 16, config: cfg }), { type: "round.draw", bracket: "main", seed: "p" });
    s = playAll(s);
    expect(pausedAt(s)).toEqual({ phase: "final", round: 1, teams: 8 });
    // Le dernier match d'une poule (rien n'est construit dessus) : rouvert, puis le vainqueur change.
    const pool = Object.values(s.matches).filter((m) => s.rounds[m.roundId]!.phase === "pool" && m.status === "done" && m.sideB.length > 0);
    const reopenable = pool.find((m) => {
      try {
        exec(s, { type: "match.reopen", matchId: m.id });
        return true;
      } catch {
        return false;
      }
    })!;
    s = exec(s, { type: "match.reopen", matchId: reopenable.id });
    expect(counts(s)).toEqual({ main: count(s, "main"), b: 0, c: 0 });
    expect(roundsOf(s, "main", "final")).toHaveLength(0);
    s = exec(s, { type: "match.score", matchId: reopenable.id, scoreA: 6, scoreB: 13 });
    expect(roundsOf(s, "main", "final")).toHaveLength(0);
    expect(count(s, "consolation")).toBe(0);
    expect(pausedAt(s)?.phase).toBe("final");
    const r = applyCommand(s, { type: "tournament.resume", seed: "j2" }, { now: "2026-10-13T08:00:00.000Z", newId: createIdGenerator("res") });
    expect(roundsOf(r.state, "main", "final")).toHaveLength(1);
    expect(count(r.state, "consolation")).toBe(1);
    expect(applyChanges(r.state, invertChanges(r.changes))).toEqual(s);
  });
});

describe("pause de 2 jours — jour 1, avant que la pause soit atteinte (testeur, daf6d71)", () => {
  /**
   * Jour 1 : le 2e tour du A (dernier avant la pause) est en cours ; tout est joué sauf un match du A (`aM`)
   * et un match du 1er tour du B (`bM`). `prepare` met aM dans un état donné, puis bM est saisi : le B,
   * dont le tour est alors complet, doit tirer son tour suivant comme d'habitude (le A n'est pas encore en pause).
   */
  function scenario(prepare: (s: EngineState, aM: Match) => EngineState) {
    let s = exec(makeState({ teams: 64, config: { ...ABC, pause: { before: { remaining: 16 } } } }), { type: "round.draw", bracket: "main", seed: "d1" });
    // Joue le 1er tour du A (le 2e tour du A et le 1er du B sont alors tirés).
    for (let i = 0; i < 200 && count(s, "main") < 2; i++) {
      const m = Object.values(s.matches).find((x) => PLAYABLE_STATUSES.has(x.status) && s.rounds[x.roundId]!.bracket === "main")!;
      s = exec(s, { type: "match.score", matchId: m.id, scoreA: 13, scoreB: 5 });
    }
    const aM = lastMatchOf(s, "main", (x) => PLAYABLE_STATUSES.has(x.status));
    const bM = lastMatchOf(s, "consolation", (x) => PLAYABLE_STATUSES.has(x.status));
    s = prepare(s, aM);
    s = playAll(s, new Set([aM.id, bM.id]));
    const before = counts(s);
    expect(canDrawNext(s, "consolation")).toBe(false);
    s = exec(s, { type: "match.score", matchId: bM.id, scoreA: 13, scoreB: 9 });
    return { before, after: counts(s) };
  }

  it("match du A simplement en attente : le B tire son 2e tour", () => {
    const { before, after } = scenario((s) => s);
    expect(after.b).toBe(before.b + 1);
  });

  it("match du A en cours (lancé) : le B tire son 2e tour", () => {
    const { before, after } = scenario((s, aM) => exec(s, { type: "match.start", matchId: aM.id }));
    expect(after.b).toBe(before.b + 1);
  });

  // Corrigé : un match lancé, signalé « à vérifier » puis remis (clear) garde son heure de début, mais son tour n'a
  // jamais été fini (pas de statut « live ») : la pause n'est pas crue atteinte.
  it("match du A lancé, signalé « à vérifier » puis remis (clear) : le B tire quand même son 2e tour", () => {
    const { before, after } = scenario((s, aM) => {
      s = exec(s, { type: "match.start", matchId: aM.id });
      s = exec(s, { type: "match.setFlag", matchId: aM.id, flag: "disputed" });
      return exec(s, { type: "match.setFlag", matchId: aM.id, flag: "clear" });
    });
    expect(after.b).toBe(before.b + 1);
  });

  it("match du A lancé puis renvoyé en file (son terrain donné à un autre match) : le B tire quand même son 2e tour", () => {
    const { before, after } = scenario((s, aM) => {
      s = exec(s, { type: "match.start", matchId: aM.id });
      const venueId = s.matches[aM.id]!.venueId;
      // Tous les autres terrains deviennent indisponibles : un match prêt retourne en file, puis la table lui donne celui de aM.
      for (const v of Object.values(s.venues)) if (v.id !== venueId) s = exec(s, { type: "venue.update", venueId: v.id, available: false });
      const other = Object.values(s.matches).find((x) => x.id !== aM.id && x.status === "waiting_venue");
      expect(venueId && other).toBeTruthy();
      s = exec(s, { type: "match.setVenue", matchId: other!.id, venueId: venueId! });
      expect(s.matches[aM.id]!.status).toBe("waiting_venue");
      expect(s.matches[aM.id]!.startedAt).not.toBeNull();
      return s;
    });
    expect(after.b).toBe(before.b + 1);
  });
});
