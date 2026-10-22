import { beforeEach, describe, expect, it } from "vitest";
import { matchesOfRound, roundsOf } from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import type { TournamentMeta } from "@/lib/tournament/load";
import { exec, makeState, resetOps } from "../../../../packages/engine/src/test-helpers";
import { renderTerrainPage, type RenderInput } from "./render";
import { TERRAIN_CSS } from "./styles.generated";

/**
 * T4 — « Enregistrer pour hors ligne » (?enregistrer=1): a self-contained file opened
 * from file:// — CSS inlined, no script, no form, no external link — even when the
 * device remembers a team that has a game to score (captains enter the scores).
 */

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
  team_format: "doublette",
  name_display: "full",
  fee_cents: 0,
  fee_per: "team",
  prize_text: null,
  rules_text: null,
  registration_mode: "open",
  max_teams: null,
} as unknown as TournamentMeta;

beforeEach(() => resetOps());

function render(standalone: boolean, o: Partial<RenderInput> = {}): string {
  let s = makeState({ teams: 16, status: "live", config: { scoreEntry: "captains" } });
  s = exec(s, { type: "round.draw", bracket: "main", seed: "t4" });
  const game = matchesOfRound(s, roundsOf(s, "main")[0]!.id).find((x) => x.sideA.length > 0 && x.sideB.length > 0)!;
  const mine = s.teams[game.sideA[0]!]!.number;
  return renderTerrainPage(
    { meta, sport: requireSport("petanque"), state: s, version: 3, view: "tirage", query: null, mine, message: null, now: new Date("2026-10-12T14:30:00Z"), ...o },
    { fragment: false, standalone, origin: "https://orgasport.fr" },
  );
}

describe("« Enregistrer pour hors ligne » file (T4)", () => {
  it("the live page of a remembered team offers the captain form and the save button", () => {
    const live = render(false);
    expect(live).toContain('<form class="score-form"');
    expect(live).toContain('href="/c/7KQ2?enregistrer=1" download');
  });

  it("is self-contained: CSS inlined, no script, no link to icons or manifest, dated, with the live address", () => {
    const saved = render(true);
    expect(saved).toContain('<html lang="fr" data-sport="petanque" class="saved">');
    expect(saved).toContain(`<style>${TERRAIN_CSS}</style>`);
    expect(saved).toContain('<table class="sheet">');
    expect(saved).not.toMatch(/<script|<noscript|<link\b/);
    expect(saved).not.toContain("enregistrer=1");
    expect(saved).toContain("Copie enregistrée le");
    expect(saved).toContain('href="https://orgasport.fr/c/7KQ2"');
    expect(Buffer.byteLength(saved)).toBeLessThan(100_000);
  });

  // Opened from file://, a root-relative link would be dead: all of them point to the site.
  it("has only absolute links (« Résultats par équipes », logo, tabs…)", () => {
    const saved = render(true);
    expect(saved).not.toMatch(/(href|action|src)="\//);
    expect(saved).toContain('href="https://orgasport.fr/c/7KQ2/equipes"');
    expect(saved).toContain('<a class="brand" href="https://orgasport.fr/">');
  });

  // The captain form of a remembered team is left out of the file (not only hidden by CSS).
  it("contains no form, input or button even for a remembered team with a game to score", () => {
    expect(render(true)).not.toMatch(/<form|<input|<button/);
  });
});
