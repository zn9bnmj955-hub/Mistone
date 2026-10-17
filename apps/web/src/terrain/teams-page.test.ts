import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { canDrawNext, matchesOfRound, roundsOf, type EngineState } from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import type { TournamentMeta } from "@/lib/tournament/load";
import { exec, makeState, PLAYABLE_STATUSES, playToEnd, resetOps } from "../../../../packages/engine/src/test-helpers";
import { renderTeamsPage } from "./teams-page";

/** Lot 2, T3: « Résultats par équipes » and list of registered teams (/c/CODE/equipes). */

const meta = {
  short_code: "7KQ2",
  name: "Concours test",
  status: "live",
  starts_at: "2026-10-12T12:00:00Z",
  city: "Aubagne",
  team_format: "triplette",
  name_display: "full",
} as unknown as TournamentMeta;

const petanque = requireSport("petanque");

beforeEach(() => resetOps());

/** Three players per team; even teams of one club, odd teams « N.H. ». Private fields are slipped in to prove they never show. */
function withPlayers(s: EngineState): EngineState {
  const players: EngineState["players"] = {};
  for (const t of Object.values(s.teams)) {
    for (const k of [1, 2, 3]) {
      const id = `p-${t.number}-${k}`;
      const club = t.number % 2 === 0 ? { number: "0340901", name: "Boule du Cap Agde" } : { number: `01302${k}${k}`, name: `Club ${k}` };
      players[id] = {
        id,
        teamId: t.id,
        firstName: ["Jean", "Élodie", "Paul"][k - 1]!,
        lastName: `${String.fromCharCode(90 - (t.number % 26))}orro${t.number}`,
        position: k,
        club,
        ...({ licence: `LIC-SECRET-${t.number}${k}`, email: `joueur${t.number}@exemple.fr`, phone: "0611223344" } as object),
      };
    }
  }
  return { ...s, players };
}

const page = (state: EngineState, o: Partial<TournamentMeta> = {}) => renderTeamsPage({ meta: { ...meta, ...o } as TournamentMeta, sport: petanque, state });

function scoreAll(s: EngineState, roundId: string, except = 0): EngineState {
  const games = matchesOfRound(s, roundId).filter((x) => PLAYABLE_STATUSES.has(x.status));
  for (const x of games.slice(0, games.length - except)) s = exec(s, { type: "match.score", matchId: x.id, scoreA: 13, scoreB: 5 });
  return s;
}

function thirteen(): EngineState {
  let s = withPlayers(makeState({ teams: 13, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" } } }));
  s = exec(s, { type: "round.draw", bracket: "main", seed: "t3" });
  s = scoreAll(s, roundsOf(s, "main")[0]!.id);
  if (canDrawNext(s, "main")) s = exec(s, { type: "round.draw", bracket: "main", seed: "t3-cadrage" });
  return s;
}

const rows = (h: string) => h.match(/<tr id="e\d+">[\s\S]*?<\/tr>/g) ?? [];
const rowOf = (h: string, n: number) => rows(h).find((r) => r.startsWith(`<tr id="e${n}">`))!;

describe("« Résultats par équipes » (T3)", () => {
  it("before the draw: list of registered teams, alphabetical, one anchor per team, no path column", () => {
    const h = page(withPlayers(makeState({ teams: 6 })), { status: "published" });
    expect(h).toContain("Liste des inscrits");
    expect(h).toContain("(6 équipes)");
    expect(h).not.toContain("<th>Parcours</th>");
    const names = rows(h).map((r) => /<b>([^<]+)<br>/.exec(r.slice(r.indexOf("<td>")))![1]!);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
    expect(rows(h)).toHaveLength(6);
    expect(h).toMatch(/<span class="st">(Inscrite|Pointée)<\/span>/);
    // Alphabetical index points at the first team of each letter.
    expect(h).toMatch(/<a href="#l-T">T<\/a> <a href="#l-U">U<\/a>/);
    expect(h).toMatch(/<b id="l-T">6<\/b>/);
  });

  it("after the draw: club or (N.H.), status per bracket and path game by game", () => {
    const h = page(thirteen());
    expect(h).toContain("Résultats par équipes");
    expect(h).toContain("<th>Parcours</th>");
    expect(rows(h)).toHaveLength(13);
    expect(h).toContain("(0340901/BOULE DU CAP AGDE)");
    expect(h).toContain("(N.H.)");
    expect(h).toMatch(/[A-Z]ORRO\d+ JEAN<br>[A-Z]ORRO\d+ ÉLODIE<br>/);
    // Every team played the 1re partie (or was exempt): winners are in play, losers out and in the B.
    const lost = rows(h).filter((r) => r.includes("Concours B : en lice"));
    expect(lost).toHaveLength(6);
    for (const r of lost) {
      expect(r).toMatch(/1re partie : perdu 5-13 c\. \d+<br>B · 1re partie : à jouer T\.\d+ c\. /);
      expect(r).not.toContain("Concours A :");
    }
    expect(rows(h).filter((r) => r.includes("Concours A : en lice"))).toHaveLength(7);
    expect(h).toMatch(/1re partie : Exempt 13-7/);
    expect(h).toMatch(/Cadrage : Office/);
    expect(h).toMatch(/Cadrage : à jouer T\.\d+ c\. /);
    expect(h).toMatch(/<b>gagné 13-5<\/b> c\. /);
  });

  it("winner of the final and teams out at a named round", () => {
    const s = playToEnd(withPlayers(makeState({ teams: 8, config: { bracketMode: "redraw", consolation: { enabled: false } } })), "t3-8");
    const h = page({ ...s, tournament: { ...s.tournament, status: "finished" } }, { status: "finished" });
    expect(rows(h).filter((r) => r.includes("Concours A : vainqueur"))).toHaveLength(1);
    expect(rows(h).filter((r) => r.includes("Concours A : éliminée en finale"))).toHaveLength(1);
    expect(rows(h).filter((r) => r.includes("Concours A : éliminée en 1/2 finale"))).toHaveLength(2);
    expect(rowOf(h, 1)).toBeTruthy();
  });

  it("never shows private data (licences, emails, phones)", () => {
    const h = page(thirteen());
    expect(h).not.toContain("LIC-SECRET");
    expect(h).not.toContain("@exemple.fr");
    expect(h).not.toContain("0611223344");
  });

  it("initials when the organizer chose them: full first names are not published", () => {
    const h = page(thirteen(), { name_display: "initials" });
    expect(h).not.toContain("ÉLODIE");
    expect(h).not.toContain("Élodie");
  });

  it("works without JavaScript: no script except the theme line, no form", () => {
    const h = page(thirteen());
    const scripts = h.match(/<script>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("os_theme");
    expect(h).not.toContain("<form");
  });

  it("concours C: losers of the B 1re partie show « Concours C » and their path through A, B and C", () => {
    let s = withPlayers(
      makeState({ teams: 16, config: { bracketMode: "redraw", consolation: { enabled: true, entry: "auto" }, consolationC: { enabled: true, entry: "auto" } } }),
    );
    s = exec(s, { type: "round.draw", bracket: "main", seed: "t3-c" });
    s = scoreAll(s, roundsOf(s, "main")[0]!.id);
    if (!roundsOf(s, "consolation").length) s = exec(s, { type: "round.draw", bracket: "consolation", seed: "t3-b" });
    s = scoreAll(s, roundsOf(s, "consolation")[0]!.id);
    if (!roundsOf(s, "consolation_c").length) s = exec(s, { type: "round.draw", bracket: "consolation_c", seed: "t3-cc" });
    const h = page(s);
    const inC = rows(h).filter((r) => r.includes("Concours C : en lice"));
    expect(inC).toHaveLength(4);
    for (const r of inC) {
      expect(r).toMatch(/1re partie : perdu 5-13 c\. \d+<br>B · 1re partie : perdu 5-13 c\. \d+<br>C · 1re partie : à jouer/);
      expect(r).not.toContain("Concours B :");
    }
    expect(rows(h).filter((r) => r.includes("Concours B : en lice"))).toHaveLength(4);
    expect(rows(h).filter((r) => r.includes("Concours A : en lice"))).toHaveLength(8);
  });

  it("escapes names and clubs typed by organizers or players (no HTML injection)", () => {
    const s = withPlayers(makeState({ teams: 4 }));
    const p1 = Object.values(s.players).find((x) => x.position === 1)!;
    // The whole team in one club, so the club name is shown.
    for (const x of Object.values(s.players).filter((x) => x.teamId === p1.teamId)) s.players[x.id] = { ...x, club: { number: "0130001", name: "<script>alert(2)</script>" } };
    s.players[p1.id] = { ...s.players[p1.id]!, lastName: '<img src=x onerror="alert(1)">' };
    const h = page(s, { status: "published" });
    expect(h).not.toMatch(/<img src=x/i);
    expect(h).not.toMatch(/<script>alert/i);
    expect(h).toMatch(/&lt;script&gt;alert\(2\)/i);
    expect(h).toContain("&lt;IMG SRC=X ONERROR=");
    expect((h.match(/<script>/gi) ?? []).length).toBe(1);
  });

  it("status of each team shown exactly: Inscrite, Pointée, Liste d'attente, Forfait, Retirée; an absent team after the draw is « Forfait » with no path", () => {
    let s = withPlayers(makeState({ teams: 8 }));
    const st = (n: number, status: string) => (s = exec(s, { type: "team.setStatus", teamId: `team-00${n}`, status } as never));
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) st(n, "registered");
    st(2, "checked_in");
    st(3, "waitlist");
    st(4, "forfeit");
    st(5, "withdrawn");
    const before = page(s, { status: "published" });
    const label = (h: string, n: number) => /<span class="st">([^<]+)<\/span>/.exec(rowOf(h, n))?.[1];
    expect([1, 2, 3, 4, 5].map((n) => label(before, n))).toEqual(["Inscrite", "Pointée", "Liste d&#39;attente", "Forfait", "Retirée"]);

    // Draw with the others checked in: the forfeit team never plays and keeps « Forfait », without any game line.
    for (const n of [1, 2, 6, 7, 8]) st(n, "checked_in");
    s = exec(s, { type: "round.draw", bracket: "main", seed: "t3-status" });
    const after = page(s);
    expect(label(after, 4)).toBe("Forfait");
    expect(rowOf(after, 4)).not.toMatch(/partie :/);
    expect(rowOf(after, 2)).toContain("Concours A : en lice");
    expect(rowOf(after, 2)).not.toContain("Pointée");
  });

  it("256 triplettes played to the end (A and B): under 100 KB", () => {
    const s = playToEnd(
      withPlayers(makeState({ teams: 256, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" } } })),
      "t3-256",
    );
    const h = page({ ...s, tournament: { ...s.tournament, status: "finished" } }, { status: "finished" });
    expect(rows(h)).toHaveLength(256);
    const size = Buffer.byteLength(h);
    expect(size).toBeLessThan(100 * 1024);
    console.info(`T3 · 256 équipes : ${Math.round(size / 1024)} Ko, ${Math.round(gzipSync(h).length / 1024)} Ko compressés`);
  });
});
