import { describe, expect, it } from "vitest";
import { requireSport } from "@orgasport/sports";
import { applyChanges, applyCommand, createIdGenerator, invertChanges, type EngineState } from "@orgasport/engine";
import { getMessages } from "@/i18n";
import { renderBody, roundText } from "./templates";
import { eventsFromChanges, type NotifyEvent } from "./events";

describe("notification texts", () => {
  it("pétanque: the message of the spec", () => {
    expect(
      renderBody(requireSport("petanque"), "your_turn", { venue: "12", time: "15 h 40", opponent: "l'équipe 27 (Dupont / Martin)" }),
    ).toBe("À vous ! Terrain 12 · 15 h 40 · contre l'équipe 27 (Dupont / Martin)");
  });
  it("football: minutes before kick-off", () => {
    expect(renderBody(requireSport("football"), "your_turn", { minutes: 10, venue: "2", opponent: "l'équipe 4 (FC Test)" })).toBe(
      "Match dans 10 min, Terrain 2 · contre l'équipe 4 (FC Test)",
    );
  });
  it("missing values never leave placeholders", () => {
    expect(renderBody(requireSport("petanque"), "your_turn", { venue: "3" })).toBe("À vous ! Terrain 3 · contre");
  });
});

type Config = EngineState["tournament"]["config"];

function tournament(teams: number, venues: number, overrides: Partial<Config> = {}): EngineState {
  const sport = requireSport("petanque");
  const state: EngineState = {
    tournament: {
      id: "t",
      status: "published",
      startsAt: "2026-10-24T12:30:00Z",
      maxTeams: null,
      config: {
        format: "single_elimination",
        bracketMode: "redraw",
        rounds: null,
        cadrage: { afterRound: 1 },
        consolation: { enabled: false, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 },
        consolationC: { enabled: false, entry: "auto", feeCents: null },
        pause: null,
        draw: { avoidSameClubFirstRound: false, seeding: false },
        pools: { size: 4, qualifiers: 2, system: "gsl" },
        autoNextRound: true,
        autoDrawAt: null,
        scoreEntry: "table",
        reservedVenuesFrom: "semifinal",
        forfeitScore: { winner: 13, loser: 0 },
        byeScore: { winner: 13, loser: 0 },
        ranking: ["wins"],
        ...overrides,
      },
    },
    rules: {
      scoring: sport.scoring as EngineState["rules"]["scoring"],
      venueUsage: "parallel",
      typicalMatchMinutes: 50,
      changeoverMinutes: 5,
      ranking: ["wins"],
      matchPoints: { win: 1, draw: 0, loss: 0 },
      teamSize: 2,
    },
    teams: {},
    players: {},
    venues: {},
    rounds: {},
    matches: {},
    teamSecrets: {},
    registrations: {},
  };
  let s = state;
  const run = (cmd: Parameters<typeof applyCommand>[1], op: string) => {
    const r = applyCommand(s, cmd, { now: "2026-10-24T12:30:00Z", newId: createIdGenerator(op), seed: op });
    s = r.state;
    return r;
  };
  for (let v = 1; v <= venues; v++) run({ type: "venue.add", label: String(v) }, `v${v}`);
  for (let i = 1; i <= teams; i++) run({ type: "team.create", players: [{ firstName: "A", lastName: `T${i}` }, { firstName: "B", lastName: `T${i}` }] }, `t${i}`);
  return Object.assign(s, { __run: run });
}

describe("events from engine changes", () => {
  it("a draw publishes the round and notifies teams that got a venue", () => {
    const s = tournament(8, 3) as EngineState & { __run: (c: unknown, op: string) => { state: EngineState; changes: never[] } };
    const r = s.__run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    const events = eventsFromChanges(r.changes, r.state);
    const draw = events.filter((e) => e.kind === "draw_published");
    const turns = events.filter((e) => e.kind === "your_turn");
    expect(draw).toHaveLength(1);
    expect(draw[0]!.teamIds).toHaveLength(8);
    // 4 matches, 3 venues: 3 matches ready (6 teams), 1 waiting.
    expect(turns).toHaveLength(3);
    expect(new Set(turns.flatMap((t) => t.teamIds)).size).toBe(6);
  });

  it("a score frees a venue: the waiting match becomes ready, the score is validated", () => {
    const s = tournament(8, 3) as EngineState & { __run: (c: unknown, op: string) => { state: EngineState; changes: never[] } };
    const drawn = s.__run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    const playing = Object.values(drawn.state.matches).find((m) => m.status === "ready")!;
    const r = s.__run({ type: "match.score", matchId: playing.id, scoreA: 13, scoreB: 7 }, "score");
    const kinds = eventsFromChanges(r.changes, r.state).map((e) => e.kind).sort();
    expect(kinds).toEqual(["score_validated", "your_turn"]);
  });

  it("is deterministic: same changes, same keys", () => {
    const s = tournament(4, 2) as EngineState & { __run: (c: unknown, op: string) => { state: EngineState; changes: never[] } };
    const r = s.__run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    expect(eventsFromChanges(r.changes, r.state).map((e) => e.key)).toEqual(eventsFromChanges(r.changes, r.state).map((e) => e.key));
  });
});

type Run = (c: unknown, op: string) => { state: EngineState; changes: never[] };
const runner = (s: EngineState) => (s as EngineState & { __run: Run }).__run;

/** Scores every playable match (side A wins), collecting the events of each action. */
function playAll(s: EngineState, run: Run, events: NotifyEvent[], tag: string): EngineState {
  let state = s;
  for (let i = 0; i < 500; i++) {
    const m = Object.values(state.matches).find((x) => x.status === "ready");
    if (!m) return state;
    const r = run({ type: "match.score", matchId: m.id, scoreA: 13, scoreB: 5 }, `${tag}${i}`);
    events.push(...eventsFromChanges(r.changes, r.state));
    state = r.state;
  }
  return state;
}

describe("cadrage, Office, B/C and pause", () => {
  const m = getMessages();

  it("13 teams: the cadrage qualifies one team « d'office », with its own message and no « tirage publié »", () => {
    const s = tournament(13, 8);
    const run = runner(s);
    const events: NotifyEvent[] = [];
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    events.push(...eventsFromChanges(r1.changes, r1.state));
    expect(events.some((e) => e.kind === "office")).toBe(false); // the exempt of the 1st game is not « d'office »
    const after = playAll(r1.state, run, events, "s");
    const office = events.filter((e) => e.kind === "office");
    expect(office).toHaveLength(1);
    const match = after.matches[(office[0] as Extract<NotifyEvent, { kind: "office" }>).matchId]!;
    const round = after.rounds[match.roundId]!;
    expect(roundText(after, round, m)).toBe("cadrage");
    const draw = events.find((e) => e.kind === "draw_published" && e.roundId === round.id)!;
    expect(draw.teamIds).toHaveLength(6);
    expect(draw.teamIds).not.toContain(office[0]!.teamIds[0]);
    expect(renderBody(requireSport("petanque"), "office", { round: roundText(after, round, m) })).toBe(
      "Qualifiés d'office pour le tour suivant (cadrage) : pas de partie à jouer.",
    );
    expect(renderBody(requireSport("petanque"), "draw_published", { round: roundText(after, round, m) })).toBe("Tirage publié : cadrage.");
  });

  it("B on « opt_in »: entering confirms once, leaving says nothing; the B draw names the bracket", () => {
    const s = tournament(8, 8, { consolation: { enabled: true, source: "losers_round_1", entry: "opt_in", feeCents: 500, losersOfRound: 1 } });
    const run = runner(s);
    const team = Object.values(s.teams)[0]!;
    const enter = run({ type: "team.enterBracket", teamId: team.id, bracket: "consolation", enter: true }, "in");
    const events = eventsFromChanges(enter.changes, enter.state);
    expect(events).toEqual([{ kind: "bracket_entry", key: `entry:${team.id}:consolation`, bracket: "consolation", teamIds: [team.id] }]);
    expect(renderBody(requireSport("petanque"), "bracket_entry", { bracket: m.notifications.brackets.consolation })).toBe("Inscription au concours B confirmée.");
    const leave = run({ type: "team.enterBracket", teamId: team.id, bracket: "consolation", enter: false }, "out");
    expect(eventsFromChanges(leave.changes, leave.state)).toEqual([]);
    // Any other change of the team (status) never repeats the confirmation.
    const again = run({ type: "team.enterBracket", teamId: team.id, bracket: "consolation", enter: true }, "in2");
    const checked = run({ type: "team.setStatus", teamId: team.id, status: "checked_in" }, "check");
    expect(eventsFromChanges(again.changes, again.state).map((e) => e.key)).toEqual([`entry:${team.id}:consolation`]);
    expect(eventsFromChanges(checked.changes, checked.state).filter((e) => e.kind === "bracket_entry")).toEqual([]);
  });

  it("B automatic: its draw is announced as « concours B, 1re partie »", () => {
    const s = tournament(8, 8, { consolation: { enabled: true, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 } });
    const run = runner(s);
    const events: NotifyEvent[] = [];
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    const after = playAll(r1.state, run, events, "s");
    const bDraws = events.filter((e) => e.kind === "draw_published" && after.rounds[e.roundId]!.bracket === "consolation");
    expect(bDraws.length).toBeGreaterThan(0);
    const first = after.rounds[(bDraws[0] as Extract<NotifyEvent, { kind: "draw_published" }>).roundId]!;
    expect(roundText(after, first, m)).toBe("concours B, 1re partie");
  });

  it("two-day pause: « Reprise demain » once, not repeated by a correction, nor after the resume", () => {
    const s = tournament(8, 8, { pause: { before: { remaining: 4 } } });
    const run = runner(s);
    const events: NotifyEvent[] = [];
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    events.push(...eventsFromChanges(r1.changes, r1.state));
    const after = playAll(r1.state, run, events, "s");
    const paused = events.filter((e) => e.kind === "paused");
    expect(paused).toHaveLength(1);
    expect(paused[0]!.key).toBe("pause:elimination:2");
    expect(paused[0]!.teamIds).toHaveLength(8);
    expect(events.filter((e) => e.kind === "draw_published")).toHaveLength(1); // the 2nd round waits
    expect(renderBody(requireSport("petanque"), "paused", {})).toBe("Fin de la journée. Reprise demain : le prochain tirage sera publié sur la page du concours.");
    // A correction during the night says nothing new.
    const done = Object.values(after.matches).find((x) => x.status === "done")!;
    const fix = run({ type: "match.score", matchId: done.id, scoreA: 13, scoreB: 11 }, "fix");
    expect(eventsFromChanges(fix.changes, fix.state).filter((e) => e.kind === "paused")).toEqual([]);
    const resume = run({ type: "tournament.resume", seed: "day2" }, "resume");
    const kinds = eventsFromChanges(resume.changes, resume.state).map((e) => e.kind);
    expect(kinds).toContain("draw_published");
    expect(kinds).not.toContain("paused");
  });

  it("pause: the evening's last score undone then entered again gives the same pause key (one « Reprise demain »), and the match put back on its venue does not call « À vous » again", () => {
    const s = tournament(8, 8, { pause: { before: { remaining: 4 } } });
    const run = runner(s);
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    let state = r1.state;
    let last: { changes: never[]; state: EngineState; matchId: string } | null = null;
    for (let i = 0; ; i++) {
      const m = Object.values(state.matches).find((x) => x.status === "ready");
      if (!m) break;
      const r = run({ type: "match.score", matchId: m.id, scoreA: 13, scoreB: 5 }, `p${i}`);
      state = r.state;
      last = { ...r, matchId: m.id };
    }
    const first = eventsFromChanges(last!.changes, last!.state).filter((e) => e.kind === "paused");
    expect(first.map((e) => e.key)).toEqual(["pause:elimination:2"]);
    // Organizer's undo (inverse changes, as executeCommand applies them).
    const undone = applyChanges(state, invertChanges(last!.changes));
    expect(undone.matches[last!.matchId]!.status).toBe("ready");
    const undoEvents = eventsFromChanges(invertChanges(last!.changes), undone);
    expect(undoEvents.filter((e) => e.kind === "your_turn" || e.kind === "paused")).toEqual([]);
    // Entered again: same key, so the queue (unique dedupe_key) keeps one message.
    const again = applyCommand(undone, { type: "match.score", matchId: last!.matchId, scoreA: 13, scoreB: 5 }, { now: "2026-10-24T20:00:00Z", newId: createIdGenerator("again"), seed: "again" });
    const second = eventsFromChanges(again.changes, again.state).filter((e) => e.kind === "paused");
    expect(second.map((e) => e.key)).toEqual(first.map((e) => e.key));
  });

  for (const order of ["A puis B", "B puis A"] as const) {
    it(`pause reached, an A match and a B match reopened during the night (${order}) then scored again: no draw announced, « Reprise demain » keeps its key, the resume announces the draws`, () => {
      const s = tournament(16, 8, {
        consolation: { enabled: true, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 },
        consolationC: { enabled: true, entry: "auto", feeCents: null },
        pause: { before: { remaining: 4 } },
      });
      const run = runner(s);
      const day1: NotifyEvent[] = [];
      const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
      const evening = playAll(r1.state, run, day1, "s");
      const pauseKeys = day1.filter((e) => e.kind === "paused").map((e) => e.key);
      expect(pauseKeys).toEqual(["pause:elimination:3"]);
      const lastDone = (bracket: string) => {
        const rounds = Object.values(evening.rounds).filter((r) => r.bracket === bracket).sort((a, b) => a.number - b.number);
        const last = rounds[rounds.length - 1]!;
        return Object.values(evening.matches).find((x) => x.roundId === last.id && x.status === "done" && x.sideB.length > 0)!;
      };
      const aMatch = lastDone("main");
      const bMatch = lastDone("consolation");
      const night: NotifyEvent[] = [];
      const step = (cmd: unknown, op: string) => {
        const r = run(cmd, op);
        night.push(...eventsFromChanges(r.changes, r.state));
        return r;
      };
      const ids = order === "A puis B" ? [aMatch.id, bMatch.id] : [bMatch.id, aMatch.id];
      ids.forEach((id, i) => step({ type: "match.reopen", matchId: id }, `re${i}`));
      step({ type: "match.score", matchId: bMatch.id, scoreA: 13, scoreB: 11 }, "fixB");
      step({ type: "match.score", matchId: aMatch.id, scoreA: 13, scoreB: 2 }, "fixA");
      // Nothing is drawn during the night (engine M5), so nothing is announced as drawn; the reopened
      // matches are corrections, never « À vous » (in « A puis B » the B match even lands on another venue).
      expect(night.filter((e) => e.kind === "draw_published" || e.kind === "your_turn")).toEqual([]);
      // Only the corrected scores, and at most the same « Reprise demain » key (one message in the queue).
      expect(night.filter((e) => e.kind === "paused").every((e) => pauseKeys.includes(e.key))).toBe(true);
      expect(night.every((e) => e.kind === "score_validated" || e.kind === "paused")).toBe(true);
      const resume = run({ type: "tournament.resume", seed: "day2" }, "resume");
      const morning = eventsFromChanges(resume.changes, resume.state);
      const drawn = new Set(morning.filter((e): e is Extract<NotifyEvent, { kind: "draw_published" }> => e.kind === "draw_published").map((e) => resume.state.rounds[e.roundId]!.bracket));
      expect(drawn.has("main")).toBe(true);
      expect(morning.some((e) => e.kind === "paused")).toBe(false);
      const keys = [...day1, ...night, ...morning].filter((e) => e.kind !== "paused").map((e) => e.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }

  it("a match only placed again (flag set then cleared, same venue and teams) notifies nobody; a venue move does", () => {
    const s = tournament(4, 3);
    const run = runner(s);
    const drawn = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    const match = Object.values(drawn.state.matches).find((x) => x.status === "ready")!;
    const flag = run({ type: "match.setFlag", matchId: match.id, flag: "disputed" }, "f1");
    const clear = run({ type: "match.setFlag", matchId: match.id, flag: "clear" }, "f2");
    expect(eventsFromChanges(flag.changes, flag.state)).toEqual([]);
    expect(eventsFromChanges(clear.changes, clear.state)).toEqual([]);
    const free = Object.values(clear.state.venues).find((v) => !Object.values(clear.state.matches).some((x) => x.venueId === v.id))!;
    const move = run({ type: "match.setVenue", matchId: match.id, venueId: free.id }, "mv");
    expect(eventsFromChanges(move.changes, move.state).map((e) => e.kind)).toEqual(["your_turn"]);
  });

  it("C on « opt_in »: « Inscription au concours C confirmée. » once (B and C entries each confirmed); C draws name the bracket", () => {
    const s = tournament(8, 8, {
      consolation: { enabled: true, source: "losers_round_1", entry: "opt_in", feeCents: null, losersOfRound: 1 },
      consolationC: { enabled: true, entry: "opt_in", feeCents: null },
    });
    const run = runner(s);
    const team = Object.values(s.teams)[0]!;
    const inB = run({ type: "team.enterBracket", teamId: team.id, bracket: "consolation", enter: true }, "b");
    const inC = runner(inB.state)({ type: "team.enterBracket", teamId: team.id, bracket: "consolation_c", enter: true }, "c");
    const events = eventsFromChanges(inC.changes, inC.state);
    expect(events).toEqual([{ kind: "bracket_entry", key: `entry:${team.id}:consolation_c`, bracket: "consolation_c", teamIds: [team.id] }]);
    expect(renderBody(requireSport("petanque"), "bracket_entry", { bracket: m.notifications.brackets.consolation_c })).toBe("Inscription au concours C confirmée.");
  });

  it("C automatic: its draws are announced as « concours C, … »", () => {
    const s = tournament(13, 8, {
      consolation: { enabled: true, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 },
      consolationC: { enabled: true, entry: "auto", feeCents: null },
    });
    const run = runner(s);
    const events: NotifyEvent[] = [];
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    events.push(...eventsFromChanges(r1.changes, r1.state));
    const after = playAll(r1.state, run, events, "s");
    const cDraws = events.filter((e): e is Extract<NotifyEvent, { kind: "draw_published" }> => e.kind === "draw_published" && after.rounds[e.roundId]!.bracket === "consolation_c");
    expect(cDraws.length).toBeGreaterThan(0);
    for (const d of cDraws) expect(roundText(after, after.rounds[d.roundId]!, m)).toMatch(/^concours C, /);
  });

  it("deduplication keys are unique over a whole tournament with cadrage, B, C and pause", () => {
    const s = tournament(13, 4, {
      consolation: { enabled: true, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 },
      consolationC: { enabled: true, entry: "auto", feeCents: null },
      pause: { before: { remaining: 4 } },
    });
    const run = runner(s);
    const events: NotifyEvent[] = [];
    const r1 = run({ type: "round.draw", bracket: "main", seed: "x" }, "draw");
    events.push(...eventsFromChanges(r1.changes, r1.state));
    let state = playAll(r1.state, run, events, "a");
    const resume = run({ type: "tournament.resume", seed: "day2" }, "resume");
    events.push(...eventsFromChanges(resume.changes, resume.state));
    state = playAll(resume.state, run, events, "b");
    expect(state.tournament.status).toBe("finished");
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ["your_turn", "draw_published", "score_validated", "office", "paused"]) expect(kinds).toContain(k);
    const keys = events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of events) expect(e.key.startsWith(e.kind === "draw_published" ? "draw:" : e.kind === "score_validated" ? "score:" : e.kind === "paused" ? "pause:" : `${e.kind}:`)).toBe(true);
  });
});
