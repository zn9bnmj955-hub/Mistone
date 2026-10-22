import { describe, expect, it } from "vitest";
import { requireSport } from "@orgasport/sports";
import { applyCommand, createIdGenerator, defaultTournamentConfig, rulesFromSport, type EngineState } from "@orgasport/engine";
import { entityToRow, rowsToEngineState, toDbChanges } from "./engine-mapping";

function demoState(): EngineState {
  const sport = requireSport("petanque");
  const config = defaultTournamentConfig(sport);
  const s: EngineState = {
    tournament: { id: "11111111-1111-4111-8111-111111111111", status: "check_in", startsAt: "2026-10-12T12:00:00.000Z", maxTeams: 16, config },
    rules: rulesFromSport(sport, "doublette"),
    teams: {},
    players: {},
    venues: {},
    rounds: {},
    matches: {},
    teamSecrets: {},
    registrations: {},
  };
  const id = createIdGenerator("demo");
  for (let i = 1; i <= 7; i++) {
    const t = id();
    s.teams[t] = { id: t, number: i, name: null, club: i % 2 ? "Les Cigales" : null, status: "checked_in", seed: null, bracket: "main", checkedInAt: "2026-10-12T11:00:00.000Z" };
    const p = id();
    s.players[p] = { id: p, teamId: t, firstName: "Jean", lastName: `Joueur${i}`, position: 1 };
    s.teamSecrets[t] = { id: t, code: "1234" };
  }
  for (let v = 1; v <= 3; v++) {
    const vid = id();
    s.venues[vid] = { id: vid, label: String(v), position: v, reservedForFinals: false, available: true };
  }
  return s;
}

describe("engine ↔ database mapping", () => {
  it("round-trips a played state without loss", () => {
    let s = demoState();
    s = applyCommand(s, { type: "round.draw", bracket: "main", seed: "x" }, { now: "2026-10-12T12:00:00.000Z", newId: createIdGenerator("op1"), seed: "x" }).state;
    const ready = Object.values(s.matches).find((m) => m.status === "ready")!;
    s = applyCommand(s, { type: "match.score", matchId: ready.id, scoreA: 13, scoreB: 4 }, { now: "2026-10-12T12:40:00.000Z", newId: createIdGenerator("op2"), seed: "y" }).state;
    const tid = s.tournament.id;
    const rows = {
      tournament: { id: tid, status: s.tournament.status, starts_at: s.tournament.startsAt, max_teams: 16 },
      teams: Object.values(s.teams).map((e) => entityToRow("team", e as never, tid)),
      players: Object.values(s.players).map((e) => entityToRow("player", e as never, tid)),
      venues: Object.values(s.venues).map((e) => entityToRow("venue", e as never, tid)),
      rounds: Object.values(s.rounds).map((e) => entityToRow("round", e as never, tid)),
      matches: Object.values(s.matches).map((e) => entityToRow("match", e as never, tid)),
      teamSecrets: Object.values(s.teamSecrets).map((e) => entityToRow("teamSecret", e as never, tid)),
      registrations: [],
    };
    expect(rowsToEngineState(rows, s.rules, s.tournament.config)).toEqual(s);
  });

  it("updates only carry changed columns, with derived team columns", () => {
    let s = demoState();
    s = applyCommand(s, { type: "round.draw", bracket: "main", seed: "x" }, { now: "2026-10-12T12:00:00.000Z", newId: createIdGenerator("op1"), seed: "x" }).state;
    const ready = Object.values(s.matches).find((m) => m.status === "ready")!;
    const res = applyCommand(s, { type: "match.score", matchId: ready.id, scoreA: 13, scoreB: 4 }, { now: "2026-10-12T12:40:00.000Z", newId: createIdGenerator("op2"), seed: "y" });
    const db = toDbChanges(res.changes, res.state, s.tournament.id);
    const scored = db.find((c) => c.id === ready.id)!;
    expect(scored.op).toBe("update");
    expect(scored.values).toMatchObject({ score_a: 13, score_b: 4, winner_side: "A", winner_team_id: ready.sideA[0], status: "done" });
    expect(scored.values).not.toHaveProperty("round_id");
  });

  it("round-trips the lot 2 fields: cadrage round, concours C, players' clubs and B/C entries", () => {
    const s = demoState();
    const tid = s.tournament.id;
    const [t1, t2] = Object.keys(s.teams);
    s.teams[t1!]!.entries = ["consolation", "consolation_c"];
    s.teams[t2!]!.bracket = "consolation_c";
    const p1 = Object.values(s.players).find((p) => p.teamId === t1)!;
    p1.club = { number: "0340901", name: "BOULE DU CAP AGDE" };
    s.rounds.r1 = { id: "r1", bracket: "main", phase: "elimination", number: 2, kind: "cadrage", status: "drawn", seed: "x", drawnAt: "2026-10-12T13:00:00.000Z" };
    s.rounds.r2 = { id: "r2", bracket: "consolation_c", phase: "elimination", number: 1, status: "pending", seed: null, drawnAt: null };
    const rows = {
      tournament: { id: tid, status: s.tournament.status, starts_at: s.tournament.startsAt, max_teams: 16 },
      teams: Object.values(s.teams).map((e) => entityToRow("team", e as never, tid)),
      players: Object.values(s.players).map((e) => entityToRow("player", e as never, tid)),
      venues: Object.values(s.venues).map((e) => entityToRow("venue", e as never, tid)),
      rounds: Object.values(s.rounds).map((e) => entityToRow("round", e as never, tid)),
      matches: [],
      teamSecrets: Object.values(s.teamSecrets).map((e) => entityToRow("teamSecret", e as never, tid)),
      registrations: [],
    };
    expect(rows.teams.find((r) => r.id === t1)).toMatchObject({ bracket_entries: ["consolation", "consolation_c"] });
    expect(rows.teams.find((r) => r.id === t2)).toMatchObject({ bracket: "consolation_c", bracket_entries: [] });
    expect(rows.players.find((r) => r.id === p1.id)).toMatchObject({ club_number: "0340901", club_name: "BOULE DU CAP AGDE" });
    expect(rows.players.find((r) => r.id !== p1.id)).toMatchObject({ club_number: null, club_name: null });
    expect(rows.rounds.find((r) => r.id === "r1")).toMatchObject({ kind: "cadrage" });
    expect(rows.rounds.find((r) => r.id === "r2")).toMatchObject({ kind: "partie", bracket: "consolation_c" });
    expect(rowsToEngineState(rows, s.rules, s.tournament.config)).toEqual(s);
  });

  it("updates of B/C entries and players' clubs carry exactly their columns", () => {
    const s = demoState();
    const [t1] = Object.keys(s.teams);
    const p1 = Object.values(s.players).find((p) => p.teamId === t1)!;
    const club = { number: "0340901", name: "BOULE DU CAP AGDE" };
    const after: EngineState = {
      ...s,
      teams: { ...s.teams, [t1!]: { ...s.teams[t1!]!, entries: ["consolation"] } },
      players: { ...s.players, [p1.id]: { ...p1, club } },
    };
    const db = toDbChanges(
      [
        { op: "update", entity: "team", id: t1!, before: { entries: undefined }, after: { entries: ["consolation"] } },
        { op: "update", entity: "player", id: p1.id, before: { club: undefined }, after: { club } },
      ],
      after,
      s.tournament.id,
    );
    expect(db).toEqual([
      { table: "teams", op: "update", key: "id", id: t1, values: { bracket_entries: ["consolation"] } },
      { table: "players", op: "update", key: "id", id: p1.id, values: { club_number: "0340901", club_name: "BOULE DU CAP AGDE" } },
    ]);
  });

  it("an update of another player field leaves the club columns untouched", () => {
    const s = demoState();
    const p1 = Object.values(s.players)[0]!;
    const after: EngineState = { ...s, players: { ...s.players, [p1.id]: { ...p1, lastName: "Nouveau" } } };
    const db = toDbChanges([{ op: "update", entity: "player", id: p1.id, before: { lastName: p1.lastName }, after: { lastName: "Nouveau" } }], after, s.tournament.id);
    expect(db[0]!.values).toEqual({ last_name: "Nouveau" });
  });
  it("a match reopened in a round played to the end: the round's « live » status is written alone and read back (two-day pause, M5)", () => {
    let s = demoState();
    let op = 0;
    const run = (cmd: Parameters<typeof applyCommand>[1]) => applyCommand(s, cmd, { now: `2026-10-12T13:${String(op).padStart(2, "0")}:00.000Z`, newId: createIdGenerator(`r${++op}`), seed: `s${op}` });
    s = run({ type: "round.draw", bracket: "main", seed: "x" }).state;
    for (let i = 0; i < 40; i++) {
      const m = Object.values(s.matches).find((x) => x.status === "ready" || x.status === "waiting_venue");
      if (!m) break;
      s = run({ type: "match.score", matchId: m.id, scoreA: 13, scoreB: 4 }).state;
    }
    expect(s.tournament.status).toBe("finished");
    const final = Object.values(s.rounds).sort((a, b) => b.number - a.number)[0]!;
    const m = Object.values(s.matches).find((x) => x.roundId === final.id && x.sideB.length > 0)!;
    const res = run({ type: "match.reopen", matchId: m.id });
    expect(res.state.rounds[final.id]!.status).toBe("live");
    const db = toDbChanges(res.changes, res.state, s.tournament.id);
    expect(db.find((c) => c.table === "rounds" && c.id === final.id)).toEqual({ table: "rounds", op: "update", key: "id", id: final.id, values: { status: "live" } });
    const t = res.state;
    const tid = t.tournament.id;
    const rows = {
      tournament: { id: tid, status: t.tournament.status, starts_at: t.tournament.startsAt, max_teams: 16 },
      teams: Object.values(t.teams).map((e) => entityToRow("team", e as never, tid)),
      players: Object.values(t.players).map((e) => entityToRow("player", e as never, tid)),
      venues: Object.values(t.venues).map((e) => entityToRow("venue", e as never, tid)),
      rounds: Object.values(t.rounds).map((e) => entityToRow("round", e as never, tid)),
      matches: Object.values(t.matches).map((e) => entityToRow("match", e as never, tid)),
      teamSecrets: Object.values(t.teamSecrets).map((e) => entityToRow("teamSecret", e as never, tid)),
      registrations: [],
    };
    expect(rowsToEngineState(rows, t.rules, t.tournament.config).rounds[final.id]!.status).toBe("live");
  });
});
