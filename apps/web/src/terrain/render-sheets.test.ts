import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { canDrawNext, matchesOfRound, roundsOf, type EngineState } from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import type { TournamentMeta } from "@/lib/tournament/load";
import { exec, makeState, PLAYABLE_STATUSES, playToEnd, resetOps } from "../../../../packages/engine/src/test-helpers";
import { renderTerrainPage, type RenderInput } from "./render";
import { TERRAIN_CSS } from "./styles.generated";

/** Lot 2, T2: the draw tab as big tables, one per round (Terrain | Équipe | Équipe | Score). */

const meta = {
  short_code: "7KQ2",
  name: "Concours test",
  status: "live",
  starts_at: "2026-10-12T12:00:00Z",
  registration_closes_at: "2026-10-12T11:00:00Z",
  checkin_closes_at: "2026-10-12T11:45:00Z",
  city: "Aubagne",
  address: "Boulodrome",
  postcode: "13400",
  team_format: "triplette",
  name_display: "full",
  fee_cents: 0,
  fee_per: "team",
  prize_text: null,
  rules_text: null,
  registration_mode: "organizer",
  max_teams: null,
} as unknown as TournamentMeta;

const petanque = requireSport("petanque");

beforeEach(() => resetOps());

/** Three players per team with long names; even teams of one club, odd teams « N.H. ». */
function withPlayers(s: EngineState): EngineState {
  const players: EngineState["players"] = {};
  for (const t of Object.values(s.teams)) {
    for (const k of [1, 2, 3]) {
      const id = `p-${t.number}-${k}`;
      const club = t.number % 2 === 0 ? { number: "0340901", name: "Boule du Cap Agde" } : { number: `01302${k}${k}`, name: `Club ${k}` };
      players[id] = { id, teamId: t.id, firstName: ["Jean-François", "Élodie", "Christophe"][k - 1]!, lastName: `Vandenbroucke${t.number}`, position: k, club };
    }
  }
  return { ...s, players };
}

function page(state: EngineState, o: Partial<RenderInput> = {}): string {
  return renderTerrainPage(
    { meta, sport: petanque, state, version: 1, view: "tirage", query: null, mine: null, message: null, now: new Date("2026-10-12T14:30:00Z"), ...o },
    { fragment: false },
  );
}

function scoreAll(s: EngineState, roundId: string, except = 0): EngineState {
  const games = matchesOfRound(s, roundId).filter((x) => PLAYABLE_STATUSES.has(x.status));
  for (const x of games.slice(0, games.length - except)) s = exec(s, { type: "match.score", matchId: x.id, scoreA: 13, scoreB: 5 });
  return s;
}

/** 13 teams: 1re partie played, cadrage drawn (3 games + 1 « Office »), one cadrage game played. */
function thirteen(): EngineState {
  let s = withPlayers(makeState({ teams: 13, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" } } }));
  s = exec(s, { type: "round.draw", bracket: "main", seed: "t2" });
  s = scoreAll(s, roundsOf(s, "main")[0]!.id);
  if (canDrawNext(s, "main")) s = exec(s, { type: "round.draw", bracket: "main", seed: "t2-cadrage" });
  return scoreAll(s, roundsOf(s, "main")[1]!.id, 2);
}

const tables = (h: string) => h.match(/<table class="sheet">[\s\S]*?<\/table>/g) ?? [];

describe("draw sheets on the public page (T2)", () => {
  it("one table per round, newest first, titled « Résultats … », A then B with anchors", () => {
    const h = page(thirteen());
    const titles = [...h.matchAll(/<h3>Résultats ([^<]+)<\/h3>/g)].map((x) => x[1]);
    expect(titles.slice(0, 2)).toEqual(["Cadrage", "1re partie"]);
    expect(titles.some((x) => x!.startsWith("Concours B · "))).toBe(true);
    expect(h.indexOf('id="concours-a"')).toBeLessThan(h.indexOf('id="concours-b"'));
    expect(h).toContain('href="#concours-b"');
    expect(tables(h)[0]).toContain("<th>Terrain</th><th>Équipe</th><th>Équipe</th><th>Score</th>");
  });

  it("links to « Résultats par équipes » and reminds Ctrl+F and F5", () => {
    const h = page(thirteen());
    expect(h).toContain('<a href="/c/7KQ2/equipes">Résultats par équipes</a>');
    expect(h).toContain("Ctrl+F pour chercher une équipe, F5 pour actualiser la page.");
  });

  it("cadrage: « Office » greyed without venue, games not played show « ** », players « NOM PRÉNOM » then club or (N.H.)", () => {
    const cadrage = tables(page(thirteen()))[0]!;
    const rows = cadrage.match(/<tr>[\s\S]*?<\/tr>/g)!.slice(1);
    expect(rows).toHaveLength(4);
    const office = rows.filter((r) => r.includes(">Office<"));
    expect(office).toHaveLength(1);
    expect(office[0]).toMatch(/^<tr><td class="c"><\/td>/);
    expect(office[0]).toContain('<td class="l o">Office</td>');
    expect(office[0]).toMatch(/<td class="c">\*\*<\/td><\/tr>$/);
    expect(rows.filter((r) => r.includes(">**<"))).toHaveLength(3);
    expect(rows.filter((r) => r.includes(">13 - 5<"))).toHaveLength(1);
    // Played game: exactly one greyed team; games not played: none.
    for (const r of rows.filter((x) => !x.includes("Office"))) {
      const greyed = (r.match(/<td class="l">/g) ?? []).length;
      expect(greyed).toBe(r.includes("13 - 5") ? 1 : 0);
      expect(r).toMatch(/<td class="c">T\.\d+<\/td>/);
    }
    expect(cadrage).toMatch(/VANDENBROUCKE\d+ JEAN-FRANÇOIS<br>VANDENBROUCKE\d+ ÉLODIE<br>VANDENBROUCKE\d+ CHRISTOPHE<br>\((N\.H\.|0340901\/BOULE DU CAP AGDE)\)/);
  });

  it("no hard-coded color: greyed cells use tokens", () => {
    const rules = TERRAIN_CSS.match(/\.sheet[^{]*\{[^}]*\}/g)!.join("");
    expect(rules).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i);
    expect(rules).toContain(".sheet td.l{background:var(--os-surface-2)");
  });

  it("my team stays on top: the card comes before the sheets and its cells are outlined", () => {
    const s = thirteen();
    const h = page(s, { mine: 5 });
    expect(h.indexOf('id="mon-equipe"')).toBeGreaterThan(0);
    expect(h.indexOf('id="mon-equipe"')).toBeLessThan(h.indexOf('<table class="sheet">'));
    expect(h).toMatch(/<td class="(l )?me"><i>5<\/i>/);
  });

  it("no script needed: the sheets are plain HTML tables without flex gap", () => {
    expect(TERRAIN_CSS).not.toMatch(/(^|[;{])gap:/);
    const h = page(thirteen());
    const body = h.replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(tables(body).length).toBeGreaterThanOrEqual(3);
  });

  it("256 triplettes played to the end (A and B): under 100 KB compressed", () => {
    const s = playToEnd(
      withPlayers(makeState({ teams: 256, config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" } } })),
      "t2-256",
    );
    const h = page({ ...s, tournament: { ...s.tournament, status: "finished" } }, { meta: { ...meta, status: "finished" } as TournamentMeta });
    const games = (h.match(/<tr><td class="c">/g) ?? []).length;
    expect(games).toBeGreaterThanOrEqual(255 + 127);
    const gz = gzipSync(h).length;
    expect(gz).toBeLessThan(100 * 1024);
    console.info(`T2 · 256 équipes : ${Math.round(h.length / 1024)} Ko, ${Math.round(gz / 1024)} Ko compressés`);
  });
});

describe("draw sheets: exempt, single bracket and escaping (T2, testeur)", () => {
  it("1re partie with 13 teams: one « Exempt » row, greyed, without venue, scored by byeScore", () => {
    const sheets = tables(page(thirteen()));
    const first = sheets[1]!; // newest first: Cadrage, then 1re partie
    const rows = first.match(/<tr>[\s\S]*?<\/tr>/g)!.slice(1);
    expect(rows).toHaveLength(7);
    const exempt = rows.filter((r) => r.includes(">Exempt<"));
    expect(exempt).toHaveLength(1);
    expect(exempt[0]).toMatch(/^<tr><td class="c"><\/td>/);
    expect(exempt[0]).toContain('<td class="l o">Exempt</td>');
    expect(first).not.toContain(">Office<");
  });

  it("A only: no « Aller au concours » links and no section heading, but still the A anchor", () => {
    let s = withPlayers(makeState({ teams: 8, config: { bracketMode: "redraw" } }));
    s = exec(s, { type: "round.draw", bracket: "main", seed: "solo" });
    const h = page(s);
    expect(h).toContain('id="concours-a"');
    expect(h).not.toContain("Aller au concours");
    expect(h).not.toContain('id="concours-b"');
    expect(tables(h)).toHaveLength(1);
  });

  it("player names are escaped in the sheet cells", () => {
    let s = makeState({ teams: 8, config: { bracketMode: "redraw" } });
    const t0 = Object.values(s.teams)[0]!;
    s = { ...s, players: { x: { id: "x", teamId: t0.id, firstName: "<img src=x onerror=alert(1)>", lastName: "o'<b>", position: 1 } } };
    s = exec(s, { type: "round.draw", bracket: "main", seed: "xss" });
    const sheet = tables(page(s)).join("");
    expect(sheet).not.toContain("<img");
    expect(sheet).not.toContain("<b>");
    expect(sheet).toContain("&lt;IMG");
  });
});

describe("draw sheets: concours C and my team when it lost (T2, testeur)", () => {
  it("A, B and C: three sections in that order, three jump links, C titled « Concours C · … »", () => {
    let s = withPlayers(
      makeState({
        teams: 16,
        config: { bracketMode: "redraw", cadrage: { afterRound: 1 }, consolation: { enabled: true, entry: "auto" }, consolationC: { enabled: true, entry: "auto" } },
      }),
    );
    s = exec(s, { type: "round.draw", bracket: "main", seed: "t2-c" });
    s = scoreAll(s, roundsOf(s, "main")[0]!.id);
    for (const b of ["consolation", "consolation_c"] as const) if (canDrawNext(s, b)) s = exec(s, { type: "round.draw", bracket: b, seed: `t2-${b}` });
    // B 1st round played so that its losers feed the C.
    const b1 = roundsOf(s, "consolation")[0];
    if (b1) s = scoreAll(s, b1.id);
    if (canDrawNext(s, "consolation_c")) s = exec(s, { type: "round.draw", bracket: "consolation_c", seed: "t2-c2" });
    expect(roundsOf(s, "consolation_c").length).toBeGreaterThan(0);

    const h = page(s);
    const a = h.indexOf('id="concours-a"');
    const b = h.indexOf('id="concours-b"');
    const c = h.indexOf('id="concours-c"');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    const nav = h.match(/<p class="sheet-nav no-print">[\s\S]*?<\/p>/)![0];
    expect(nav).toContain("Aller au concours");
    for (const anchor of ["concours-a", "concours-b", "concours-c"]) expect(nav).toContain(`href="#${anchor}"`);
    expect(h).toMatch(/<h3>Résultats Concours C · [^<]+<\/h3>/);
  });

  it("my team that lost is both greyed and outlined (class « l me »), the winner opposite is not greyed", () => {
    let s = withPlayers(makeState({ teams: 8, config: { bracketMode: "redraw" } }));
    s = exec(s, { type: "round.draw", bracket: "main", seed: "t2-me" });
    const game = matchesOfRound(s, roundsOf(s, "main")[0]!.id)[0]!;
    // Side A wins 13-5: its opponent (side B) lost.
    s = exec(s, { type: "match.score", matchId: game.id, scoreA: 13, scoreB: 5 });
    const loser = s.teams[game.sideB[0]!]!.number;
    const winner = s.teams[game.sideA[0]!]!.number;
    const sheet = tables(page(s, { mine: loser }))[0]!;
    expect(sheet).toContain(`<td class="l me"><i>${loser}</i>`);
    expect(sheet).not.toContain(`<td class="l"><i>${winner}</i>`);
    expect(sheet).not.toContain(`<td class="l me"><i>${winner}</i>`);
  });
});

describe("draw sheets: live refresh (T2, testeur)", () => {
  it("the live fragment (Realtime or 30 s refresh) carries the same sheets, links and my team card on top as the full page", () => {
    const s = thirteen();
    const input = { meta, sport: petanque, state: s, version: 1, view: "tirage", query: null, mine: 5, message: null, now: new Date("2026-10-12T14:30:00Z") } as RenderInput;
    const full = renderTerrainPage(input, { fragment: false });
    const frag = renderTerrainPage(input, { fragment: true });
    expect(frag.startsWith('<div id="live"')).toBe(true);
    expect(tables(frag)).toEqual(tables(full));
    expect(tables(frag).length).toBeGreaterThanOrEqual(3);
    expect(frag).toContain('href="#concours-b"');
    expect(frag).toContain('<a href="/c/7KQ2/equipes">Résultats par équipes</a>');
    expect(frag.indexOf('id="mon-equipe"')).toBeGreaterThan(0);
    expect(frag.indexOf('id="mon-equipe"')).toBeLessThan(frag.indexOf('<table class="sheet">'));
    expect(full).toContain(frag);
  });
});
