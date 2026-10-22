import { beforeEach, describe, expect, it } from "vitest";
import { canDrawNext, matchesOfRound, roundsOf, type EngineState } from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import { getMessages } from "@/i18n";
import { exec, makeState, PLAYABLE_STATUSES, playToEnd, resetOps } from "../../../../packages/engine/src/test-helpers";
import { buildTeamViews, currentMatch, currentRounds, drawSheets, roundLabel, teamTimeline, type DrawRow } from "./view-model";

/** Lot 2, T1: draw sheets like the federation results pages (« resultats-ppf »). */

const m = getMessages();
const petanque = requireSport("petanque");

beforeEach(() => resetOps());

/** Two players per team; team 1 from one club, team 2 « N.H. », team 3 unknown. */
function withPlayers(s: EngineState): EngineState {
  const players: EngineState["players"] = {};
  for (const t of Object.values(s.teams)) {
    const club = (k: number) =>
      t.number === 1 ? { number: "0340901", name: "Boule du Cap Agde" } : t.number === 2 ? { number: k === 1 ? "0340901" : "0130222", name: k === 1 ? "Boule du Cap Agde" : "La Ciotat" } : null;
    for (const k of [1, 2]) {
      const id = `p-${t.number}-${k}`;
      players[id] = { id, teamId: t.id, firstName: k === 1 ? "Jean" : "Élodie", lastName: `Nom${t.number}`, position: k, club: club(k) };
    }
  }
  return { ...s, players };
}

/** Scores every playable game of the bracket (side A wins 13 to 5) and lets the engine draw on. */
function scoreAll(s: EngineState, roundId: string, except = 0): EngineState {
  const games = matchesOfRound(s, roundId).filter((x) => PLAYABLE_STATUSES.has(x.status));
  for (const x of games.slice(0, games.length - except)) s = exec(s, { type: "match.score", matchId: x.id, scoreA: 13, scoreB: 5 });
  return s;
}

/** 13 teams, cadrage after the 1st game: 6 games + 1 exempt, then cadrage 3 games + 1 « d'office ». */
function thirteen(): EngineState {
  let s = withPlayers(makeState({ teams: 13, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" } } }));
  s = exec(s, { type: "round.draw", bracket: "main", seed: "t1" });
  s = scoreAll(s, roundsOf(s, "main")[0]!.id);
  if (canDrawNext(s, "main")) s = exec(s, { type: "round.draw", bracket: "main", seed: "t1-cadrage" });
  // One cadrage game played, the two others not yet.
  return scoreAll(s, roundsOf(s, "main")[1]!.id, 2);
}

const flat = (rows: DrawRow[]) => rows.map((r) => `${r.alone ?? "game"}:${r.score}`);

describe("draw sheets (T1)", () => {
  it("13 teams with cadrage: one section per round, newest first, named by the engine", () => {
    const s = thirteen();
    const sheets = drawSheets(s, buildTeamViews(s, "full"), petanque, m);
    expect(sheets.map((b) => b.title)).toEqual(["Concours A", "Concours B"]);
    const a = sheets[0]!;
    expect(a.rounds.map((r) => r.label)).toEqual(["Cadrage", "1re partie"]);
    expect(a.rounds.map((r) => r.round.number)).toEqual([2, 1]);
    expect(sheets[1]!.rounds.at(-1)!.label).toBe("Concours B · 1re partie");
  });

  it("cadrage: 3 games and 1 team facing « Office », without venue and with « ** »", () => {
    const s = thirteen();
    const cadrage = drawSheets(s, buildTeamViews(s, "full"), petanque, m)[0]!.rounds[0]!;
    expect(cadrage.rows).toHaveLength(4);
    const office = cadrage.rows.filter((r) => r.alone === "office");
    expect(office).toHaveLength(1);
    expect(office[0]).toMatchObject({ venue: "", b: null, score: "**" });
    expect(office[0]!.a!.lost).toBe(false);
    expect(flat(cadrage.rows).sort()).toEqual(["game:**", "game:**", "game:13 - 5", "office:**"]);
    // Games not played yet: « ** », a venue « T.n », nobody greyed.
    for (const r of cadrage.rows.filter((x) => x.alone === null && x.score === "**")) {
      expect(r.venue).toMatch(/^T\.\d+$/);
      expect(r.a!.lost || r.b!.lost).toBe(false);
    }
  });

  it("1re partie: the loser is greyed, the exempt gets the bye score", () => {
    const s = thirteen();
    const first = drawSheets(s, buildTeamViews(s, "full"), petanque, m)[0]!.rounds[1]!;
    expect(first.rows).toHaveLength(7);
    const exempt = first.rows.filter((r) => r.alone === "exempt");
    expect(exempt).toHaveLength(1);
    const bye = s.tournament.config.byeScore;
    expect(exempt[0]!.score).toBe(`${bye.winner} - ${bye.loser}`);
    for (const r of first.rows.filter((x) => x.alone === null)) {
      expect(r.score).toBe("13 - 5");
      expect(r.a!.lost).toBe(false);
      expect(r.b!.lost).toBe(true);
    }
  });

  it("each team: players « NOM PRÉNOM » one per line, then its club, « (N.H.) » or nothing", () => {
    const s = thirteen();
    const sides = drawSheets(s, buildTeamViews(s, "full"), petanque, m)[0]!.rounds[1]!.rows.flatMap((r) => [r.a, r.b]).filter((x) => x !== null);
    const byNumber = new Map(sides.map((x) => [x.number, x]));
    expect(byNumber.get("1")).toMatchObject({ players: ["NOM1 JEAN", "NOM1 ÉLODIE"], affiliation: "(0340901/BOULE DU CAP AGDE)" });
    expect(byNumber.get("2")).toMatchObject({ players: ["NOM2 JEAN", "NOM2 ÉLODIE"], affiliation: "(N.H.)" });
    expect(byNumber.get("3")).toMatchObject({ players: ["NOM3 JEAN", "NOM3 ÉLODIE"], affiliation: null });
  });

  it("keeps the organizer's choice of initials", () => {
    const s = thirteen();
    const sides = drawSheets(s, buildTeamViews(s, "initials"), petanque, m)[0]!.rounds[1]!.rows.flatMap((r) => [r.a, r.b]).filter((x) => x !== null);
    expect(sides.find((x) => x.number === "1")!.players).toEqual(["N. J.", "N. É."]);
    expect(JSON.stringify(sides)).not.toMatch(/NOM\d/);
  });

  it("nothing drawn yet: no section", () => {
    const s = makeState({ teams: 13 });
    expect(drawSheets(s, buildTeamViews(s, "full"), petanque, m)).toEqual([]);
  });

  it("round names follow the results pages: 7 teams give 1re partie, 1/2 finale, finale", () => {
    let s = makeState({ teams: 7, config: { bracketMode: "redraw", consolation: { enabled: false } } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "seven" });
    for (let i = 0; i < 3; i++) {
      s = scoreAll(s, roundsOf(s, "main").at(-1)!.id);
      if (canDrawNext(s, "main")) s = exec(s, { type: "round.draw", bracket: "main", seed: `seven-${i}` });
    }
    expect(roundsOf(s, "main").map((r) => roundLabel(s, r, m))).toEqual(["1re partie", "1/2 finale", "Finale"]);
  });
});

describe("draw sheets (T1, vérification du testeur)", () => {
  it("13 teams played to the end with B and C: three sections A, B, C, newest round first, prefixed names", () => {
    const s = playToEnd(
      makeState({ teams: 13, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" }, consolationC: { enabled: true, entry: "auto" } } }),
      "t1-abc",
    );
    const sheets = drawSheets(s, buildTeamViews(s, "full"), petanque, m);
    expect(sheets.map((b) => b.title)).toEqual(["Concours A", "Concours B", "Concours C"]);
    expect(sheets.map((b) => b.rounds.map((r) => r.label))).toEqual([
      ["Finale", "1/2 finale", "Cadrage", "1re partie"],
      ["Concours B · Finale", "Concours B · Cadrage", "Concours B · 1re partie"],
      ["Concours C · Finale", "Concours C · 1re partie"],
    ]);
    // Finished: every game has a score and exactly one greyed side; only « d'office » lines keep « ** ».
    for (const row of sheets.flatMap((b) => b.rounds.flatMap((r) => r.rows))) {
      if (row.alone === "office") {
        expect(row).toMatchObject({ score: "**", venue: "", b: null });
        expect(row.a!.lost).toBe(false);
      } else if (row.alone === "exempt") {
        expect(row.b).toBeNull();
        expect(row.a!.lost).toBe(false);
        expect(row.score).not.toBe("**");
      } else {
        expect(row.score).toMatch(/^\d+ - \d+$/);
        expect([row.a!.lost, row.b!.lost].filter(Boolean)).toHaveLength(1);
      }
    }
  });

  it("a game lost by forfeit: the absent team is greyed and the forfeit score is shown", () => {
    let s = makeState({ teams: 8, config: { bracketMode: "redraw", consolation: { enabled: false } } });
    s = exec(s, { type: "round.draw", bracket: "main", seed: "forfait" });
    const game = matchesOfRound(s, roundsOf(s, "main")[0]!.id)[0]!;
    s = exec(s, { type: "match.forfeit", matchId: game.id, side: "B" });
    const row = drawSheets(s, buildTeamViews(s, "full"), petanque, m)[0]!.rounds[0]!.rows.find((r) => r.matchId === game.id)!;
    expect(row.a!.lost).toBe(false);
    expect(row.b!.lost).toBe(true);
    const f = s.tournament.config.forfeitScore;
    expect(row.score).toBe(`${f.winner} - ${f.loser}`);
  });
});

describe("pause de 2 jours : tour du A rouvert la nuit (statut « live », M5)", () => {
  it("le tour rouvert est le tour affiché, la partie rouverte montre « ** » et redevient le prochain match de ses équipes ; les autres gardent leur score", () => {
    let s = withPlayers(makeState({ teams: 8, config: { bracketMode: "redraw", pause: { before: { remaining: 4 } } } }));
    s = exec(s, { type: "round.draw", bracket: "main", seed: "p8" });
    s = scoreAll(s, roundsOf(s, "main")[0]!.id);
    const round = roundsOf(s, "main")[0]!;
    expect(roundsOf(s, "main")).toHaveLength(1);
    const reopened = matchesOfRound(s, round.id).find((x) => x.status === "done" && x.sideB.length > 0)!;
    s = exec(s, { type: "match.reopen", matchId: reopened.id });
    expect(s.rounds[round.id]!.status).toBe("live");
    expect(currentRounds(s, "main").map((r) => r.id)).toEqual([round.id]);
    const teams = buildTeamViews(s, "full", m);
    const sheet = drawSheets(s, teams, petanque, m).find((b) => b.bracket === "main")!;
    expect(sheet.rounds).toHaveLength(1);
    const rows = sheet.rounds[0]!.rows;
    expect(rows.find((r) => r.matchId === reopened.id)!.score).toBe(m.terrain.sheet.notPlayed);
    expect(rows.filter((r) => r.matchId !== reopened.id && r.score === "13 - 5").length).toBe(rows.length - 1);
    const now = currentMatch(teamTimeline(s, reopened.sideA[0]!));
    expect(now?.match.id).toBe(reopened.id);
    expect(now?.round.status).toBe("live");
  });
});
