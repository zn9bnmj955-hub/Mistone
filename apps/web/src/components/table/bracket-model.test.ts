import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  canDrawNext,
  createIdGenerator,
  defaultTournamentConfig,
  matchesOfRound,
  roundsOf,
  rulesFromSport,
  type Command,
  type EngineState,
  type TournamentConfig,
} from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import { collectsEntries, entryCandidates, loneSideLabel, pauseHeld, pauseOf, tableBrackets } from "./bracket-model";
import type { ScoringTable } from "./store";
import { CloseLinkPanel, DrawTab, StatusControls } from "./tabs";
import { roundName } from "./ui";

/** TM3: the scoring table and the A / B / C, the cadrage, the pause and the final close. */

let op = 0;
function exec(state: EngineState, cmd: Command): EngineState {
  op++;
  const now = new Date(Date.UTC(2026, 9, 12, 12, 0) + op * 60_000).toISOString();
  return applyCommand(state, cmd, { now, newId: createIdGenerator(`op-${op}`), seed: `seed-${op}` }).state;
}

function makeState(teams: number, over: Partial<TournamentConfig> = {}): EngineState {
  const sport = requireSport("petanque");
  const base = defaultTournamentConfig(sport);
  const config: TournamentConfig = { ...base, ...over, consolation: { ...base.consolation, ...over.consolation }, consolationC: { ...base.consolationC, ...over.consolationC } };
  const state: EngineState = {
    tournament: { id: "t1", status: "check_in", startsAt: null, maxTeams: null, config },
    rules: rulesFromSport(sport),
    teams: {},
    players: {},
    venues: {},
    rounds: {},
    matches: {},
    teamSecrets: {},
    registrations: {},
  };
  for (let i = 1; i <= teams; i++) {
    const id = `team-${String(i).padStart(3, "0")}`;
    state.teams[id] = { id, number: i, name: `Équipe ${i}`, club: null, status: "checked_in", seed: null, bracket: "main", checkedInAt: "2026-10-12T11:00:00.000Z" };
  }
  for (let v = 1; v <= 20; v++) state.venues[`v${v}`] = { id: `v${v}`, label: String(v), position: v, reservedForFinals: false, available: true };
  return state;
}

/** Plays every open game of a bracket's last round (side A wins 13-5). */
function playLast(state: EngineState, bracket: "main" | "consolation" | "consolation_c" = "main"): EngineState {
  const rounds = roundsOf(state, bracket);
  const last = rounds[rounds.length - 1]!;
  let s = state;
  for (const m of matchesOfRound(s, last.id)) {
    if (m.sideA.length && m.sideB.length && m.status !== "done" && m.status !== "forfeit") s = exec(s, { type: "match.score", matchId: m.id, scoreA: 13, scoreB: 5 });
  }
  return s;
}

const OPT_IN_B: Partial<TournamentConfig> = {
  consolation: { enabled: true, source: "losers_round_1", entry: "opt_in", feeCents: 500, losersOfRound: 1 },
  consolationC: { enabled: false, entry: "auto", feeCents: null },
  pause: { before: { remaining: 4 } },
  autoNextRound: true,
};

const fakeTable = (sent: Command[]) => ({ dispatch: (c: Command) => (sent.push(c), true) }) as unknown as ScoringTable;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("A / B / C on the scoring table", () => {
  it("lists the brackets of the configuration only", () => {
    expect(tableBrackets(makeState(8, { consolation: { enabled: false, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 } }))).toEqual(["main"]);
    expect(tableBrackets(makeState(8, OPT_IN_B))).toEqual(["main", "consolation"]);
    expect(tableBrackets(makeState(8, { ...OPT_IN_B, consolationC: { enabled: true, entry: "opt_in", feeCents: null } }))).toEqual(["main", "consolation", "consolation_c"]);
  });

  it("opt_in B: every team may tick before the 1st game, then only its losers", () => {
    let s = makeState(13, OPT_IN_B);
    expect(collectsEntries(s, "consolation")).toBe(true);
    expect(collectsEntries(s, "main")).toBe(false);
    expect(entryCandidates(s, "consolation")).toHaveLength(13);
    expect(entryCandidates(s, "consolation").every((c) => !c.eligible && !c.entered)).toBe(true);

    s = playLast(exec(s, { type: "round.draw", bracket: "main", seed: "a" }));
    const list = entryCandidates(s, "consolation");
    expect(list).toHaveLength(6);
    expect(list.every((c) => c.eligible)).toBe(true);

    // A team entered early that then won stays listed (to untick it), marked not concerned.
    const winner = Object.keys(s.teams).find((id) => !list.some((c) => c.id === id))!;
    s = exec(s, { type: "team.enterBracket", teamId: winner, bracket: "consolation", enter: true });
    const after = entryCandidates(s, "consolation");
    expect(after).toHaveLength(7);
    expect(after.find((c) => c.id === winner)).toMatchObject({ entered: true, eligible: false });
  });

  it("the Tirage tab: checkboxes send team.enterBracket, then « Tirer le B » appears and entries close", () => {
    let s = playLast(exec(makeState(13, OPT_IN_B), { type: "round.draw", bracket: "main", seed: "a" }));
    const sent: Command[] = [];
    let page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).toContain("Inscriptions au B");
    expect(page).toMatch(/Droit d&#x27;inscription : 5\s€ par équipe/);
    expect(page).toContain("0 équipe(s) inscrite(s).");
    expect(page).not.toContain("Tirer le B");
    expect(page).toContain("Tableau affiché");

    for (const c of entryCandidates(s, "consolation").slice(0, 4)) s = exec(s, { type: "team.enterBracket", teamId: c.id, bracket: "consolation", enter: true });
    page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).toContain("4 équipe(s) inscrite(s).");
    expect(page).toContain("Tirer le B");

    s = exec(s, { type: "round.draw", bracket: "consolation", seed: "b" });
    expect(collectsEntries(s, "consolation")).toBe(false);
    page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).not.toContain("Inscriptions au B");
    expect(page).toContain("Concours B · ");
  });

  it("opt_in C: the B's 1st-game losers are ticked, « Tirer le C », and B / C rounds are named « Concours B · … »", () => {
    const AUTO_B_OPT_IN_C: Partial<TournamentConfig> = {
      consolation: { enabled: true, source: "losers_round_1", entry: "auto", feeCents: null, losersOfRound: 1 },
      consolationC: { enabled: true, entry: "opt_in", feeCents: 300 },
      pause: null,
      autoNextRound: true,
    };
    let s = playLast(exec(makeState(13, AUTO_B_OPT_IN_C), { type: "round.draw", bracket: "main", seed: "a" }));
    // The B (auto) takes the 6 losers of the A's 1st game; the C still collects entries.
    if (roundsOf(s, "consolation").length === 0) s = exec(s, { type: "round.draw", bracket: "consolation", seed: "b" });
    expect(collectsEntries(s, "consolation")).toBe(false);
    expect(collectsEntries(s, "consolation_c")).toBe(true);
    const b1 = roundsOf(s, "consolation")[0]!;
    expect(roundName(s, b1)).toBe("Concours B · 1re partie");

    s = playLast(s, "consolation");
    const list = entryCandidates(s, "consolation_c");
    expect(list).toHaveLength(3);
    expect(list.every((c) => c.eligible && !c.entered)).toBe(true);

    const sent: Command[] = [];
    let page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).toContain("Inscriptions au C");
    expect(page).toMatch(/Droit d&#x27;inscription : 3\s€ par équipe/);
    expect(page).not.toContain("Tirer le C");

    for (const c of list.slice(0, 2)) s = exec(s, { type: "team.enterBracket", teamId: c.id, bracket: "consolation_c", enter: true });
    page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).toContain("2 équipe(s) inscrite(s).");
    expect(page).toContain("Tirer le C");

    // B: 3 winners of its 1st game → its own cadrage (1 game, 1 « Office »).
    const b2 = roundsOf(s, "consolation")[1]!;
    expect(roundName(s, b2)).toBe("Concours B · Cadrage");
    expect(matchesOfRound(s, b2.id).filter((x) => loneSideLabel(s, x) === "office")).toHaveLength(1);

    s = exec(s, { type: "round.draw", bracket: "consolation_c", seed: "c" });
    expect(collectsEntries(s, "consolation_c")).toBe(false);
    page = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(page).not.toContain("Inscriptions au C");
    expect(page).toContain("Concours C · ");
  });

  it("cadrage rounds are named « Cadrage » and show « Office » facing a team qualified without playing", () => {
    let s = playLast(exec(makeState(13, { ...OPT_IN_B, pause: null }), { type: "round.draw", bracket: "main", seed: "a" }));
    // 7 teams left: cadrage = 3 games and 1 « d'office ».
    const rounds = roundsOf(s, "main");
    const cadrage = rounds[1]!;
    expect(roundName(s, cadrage)).toBe("Cadrage");
    const lone = matchesOfRound(s, cadrage.id).filter((x) => loneSideLabel(s, x) === "office");
    expect(lone).toHaveLength(1);
    // The 1st game's exempt is an exempt, not an « Office ».
    expect(matchesOfRound(s, rounds[0]!.id).map((x) => loneSideLabel(s, x)).filter(Boolean)).toEqual(["exempt"]);
    const page = html(createElement(DrawTab, { table: fakeTable([]), state: s }));
    expect(page).toContain(">Cadrage<");
    expect(page).toContain(">Office<");
    expect(page).toMatch(/>Office<\/span><span class="[^"]*"><\/span>/);
    s = playLast(s);
    expect(roundName(s, roundsOf(s, "main")[2]!)).toBe("1/2 finale");
  });

  it("two-day pause: « Reprendre le concours » sends tournament.resume; no ordinary draw button meanwhile", () => {
    let s = playLast(exec(makeState(13, OPT_IN_B), { type: "round.draw", bracket: "main", seed: "a" }));
    s = playLast(s); // cadrage played: 4 left, the pause holds the 1/2.
    expect(pauseOf(s)).toMatchObject({ teams: 4 });
    const sent: Command[] = [];
    const status = html(createElement(StatusControls, { table: fakeTable(sent), state: s }));
    expect(status).toContain("Concours en pause");
    expect(status).toContain("Reprendre le concours");
    expect(html(createElement(DrawTab, { table: fakeTable(sent), state: s }))).not.toContain("Tirer le tour suivant");

    s = exec(s, { type: "tournament.resume", seed: "day2" });
    expect(pauseOf(s)).toBeNull();
    expect(html(createElement(StatusControls, { table: fakeTable(sent), state: s }))).not.toContain("Reprendre le concours");
  });

  it("a match of the A reopened during the night: still « en pause », no « Tirer le B », « Reprendre » once scored again (local engine)", () => {
    const AUTO_B: Partial<TournamentConfig> = { ...OPT_IN_B, consolation: { ...OPT_IN_B.consolation!, entry: "auto" }, pause: { before: { remaining: 8 } } };
    let s = exec(makeState(32, AUTO_B), { type: "round.draw", bracket: "main", seed: "a" });
    for (let i = 0; i < 200; i++) {
      const open = Object.values(s.matches).find((x) => x.sideA.length && x.sideB.length && ["ready", "waiting_venue", "playing"].includes(x.status));
      if (!open) break;
      s = exec(s, { type: "match.score", matchId: open.id, scoreA: 13, scoreB: 5 });
    }
    expect(pauseOf(s)).toMatchObject({ teams: 8 });
    expect(canDrawNext(s, "consolation")).toBe(true);
    const lastA = roundsOf(s, "main").at(-1)!;
    const played = matchesOfRound(s, lastA.id).find((x) => x.status === "done")!;
    s = exec(s, { type: "match.reopen", matchId: played.id });
    // The engine holds the B (M5) while pausedAt is null: the table says so and offers no draw.
    expect(pauseOf(s)).toBeNull();
    expect(pauseHeld(s)).toBe(true);
    const sent: Command[] = [];
    let status = html(createElement(StatusControls, { table: fakeTable(sent), state: s }));
    expect(status).toContain("Concours en pause");
    expect(status).toContain("a été rouvert");
    expect(status).not.toContain("Reprendre le concours");
    const draw = html(createElement(DrawTab, { table: fakeTable(sent), state: s }));
    expect(draw).not.toContain("Tirer le B");
    expect(draw).not.toContain("Tirer le tour suivant");

    s = exec(s, { type: "match.score", matchId: played.id, scoreA: 5, scoreB: 13 });
    expect(pauseOf(s)).toMatchObject({ teams: 8 });
    status = html(createElement(StatusControls, { table: fakeTable(sent), state: s }));
    expect(status).toContain("Reprendre le concours");
    const bRounds = roundsOf(s, "consolation").length;
    s = exec(s, { type: "tournament.resume", seed: "day2" });
    expect(pauseHeld(s)).toBe(false);
    expect(roundsOf(s, "consolation").length).toBe(bRounds + 1);
    expect(html(createElement(StatusControls, { table: fakeTable(sent), state: s }))).not.toContain("Concours en pause");
  });

  it("the final close is only offered once finished, folded behind a first button", () => {
    const s = makeState(4);
    expect(html(createElement(CloseLinkPanel, { table: fakeTable([]), state: s }))).toBe("");
    const finished: EngineState = { ...s, tournament: { ...s.tournament, status: "finished" } };
    const panel = html(createElement(CloseLinkPanel, { table: fakeTable([]), state: finished }));
    expect(panel).toContain("Clôture définitive");
    expect(panel).toContain("Clore définitivement…");
    // Second confirmation (tick + button) is not shown until the first click.
    expect(panel).not.toContain("J&#x27;ai vérifié");
    const archived: EngineState = { ...s, tournament: { ...s.tournament, status: "archived" } };
    expect(html(createElement(StatusControls, { table: fakeTable([]), state: archived }))).toContain("Concours clos définitivement");
    expect(html(createElement(CloseLinkPanel, { table: fakeTable([]), state: archived }))).toBe("");
  });
});
