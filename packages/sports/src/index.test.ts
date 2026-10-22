import { describe, expect, it } from "vitest";
import {
  SPORTS,
  competitionFormatsFor,
  enabledSports,
  formatTemplate,
  getSport,
  isValidLicenseNumber,
  requireSport,
  sportConfigSchema,
} from "./index";
import { petanque } from "./sports/petanque";
import { football } from "./sports/football";

const s0 = () => requireSport("petanque");

describe("sport registry", () => {
  it("validates every built-in sport", () => {
    expect(SPORTS.length).toBeGreaterThanOrEqual(2);
    for (const s of SPORTS) expect(() => sportConfigSchema.parse(s)).not.toThrow();
  });

  it("keeps defaults consistent with the declared options", () => {
    for (const s of SPORTS) {
      expect(s.teamFormats.map((f) => f.id)).toContain(s.defaults.teamFormat);
      expect(s.competitionFormats).toContain(s.defaults.competitionFormat);
      expect(s.categories).toContain(s.defaults.category);
    }
  });

  it("keeps team formats inside the sport's competition formats", () => {
    for (const s of SPORTS) for (const f of s.teamFormats) {
      expect(competitionFormatsFor(s, f.id).length).toBeGreaterThan(0);
      for (const c of f.competitionFormats ?? []) expect(s.competitionFormats).toContain(c);
    }
    expect(competitionFormatsFor(s0(), s0().defaults.teamFormat)).toContain(s0().defaults.competitionFormat);
  });

  it("plays a drawn mêlée only as a mêlée, and registered teams never as one", () => {
    const sport = requireSport("petanque");
    for (const f of sport.teamFormats) {
      const formats = competitionFormatsFor(sport, f.id);
      if (f.individualRegistration) expect(formats).toEqual(["melee_rotation"]);
      else expect(formats).not.toContain("melee_rotation");
    }
  });

  it("finds sports by slug", () => {
    expect(getSport("petanque")?.name).toBe("Pétanque");
    expect(getSport("curling")).toBeUndefined();
    expect(() => requireSport("curling")).toThrow();
  });

  it("accepts a brand new sport without code changes", () => {
    const darts = sportConfigSchema.parse({
      ...petanque,
      slug: "flechettes",
      name: "Fléchettes",
      icon: "darts",
      accentToken: "flechettes",
      venue: { kind: "target", noun: { singular: "cible", plural: "cibles" }, usage: "parallel" },
      teamFormats: [{ id: "solo", label: "Individuel", players: 1, substitutes: { min: 0, max: 0 } }],
      scoring: { mode: "sets", setsToWin: 3, pointsPerSet: 501, allowDraw: false },
      defaults: { ...petanque.defaults, teamFormat: "solo", venues: 8 },
    });
    expect(darts.venue.noun.singular).toBe("cible");
  });
});

describe("pétanque only (football switched off, code kept)", () => {
  it("offers pétanque alone", () => {
    expect(enabledSports().map((s) => s.slug)).toEqual(["petanque"]);
  });

  it("still resolves football for existing tournaments", () => {
    expect(getSport("football")?.name).toBe("Football");
    expect(requireSport("football").enabled).toBe(false);
  });

  it("switching football back on is a single boolean", () => {
    // The football file only differs from an offered sport by `enabled`: flipping it gives a valid, offered sport.
    const on = sportConfigSchema.parse({ ...football, enabled: true });
    expect(on).toEqual({ ...requireSport("football"), enabled: true });
    expect([...SPORTS.filter((s) => s.slug !== "football"), on].filter((s) => s.enabled).map((s) => s.slug).sort()).toEqual(["football", "petanque"]);
  });
});

describe("elimination defaults (cadrage, B/C, bye)", () => {
  it("pétanque: new draw each round, cadrage after the 1st game, automatic B, no C, bye 13-7", () => {
    const d = s0().defaults;
    expect(d.redrawEachRound).toBe(true);
    expect(d.cadrageAfterRound).toBe(1);
    expect(d.consolation).toBe(true);
    expect(d.consolationEntry).toBe("auto");
    expect(d.consolationC).toBe(false);
    expect(d.byeScore).toEqual({ winner: 13, loser: 7 });
  });

  it("football: fixed tree, no B or C, no separate bye score", () => {
    const d = requireSport("football").defaults;
    expect(d.redrawEachRound).toBe(false);
    expect(d.consolation).toBe(false);
    expect(d.consolationC).toBe(false);
    expect(d.byeScore).toBeNull();
  });
});

describe("license format", () => {
  const sport = requireSport("petanque");
  it("checks the format only", () => {
    expect(isValidLicenseNumber(sport, "01234567")).toBe(true);
    expect(isValidLicenseNumber(sport, " 0123456 ")).toBe(true);
    expect(isValidLicenseNumber(sport, "12AB")).toBe(false);
    expect(isValidLicenseNumber(sport, "")).toBe(false);
  });
});

describe("notification templates", () => {
  it("fills placeholders", () => {
    const sport = requireSport("petanque");
    expect(
      formatTemplate(sport.notifications.yourTurn, {
        venueLabel: "Terrain",
        venue: "12",
        time: "15 h 40",
        opponent: "l'équipe 27 (Dupont / Martin)",
      }),
    ).toBe("À vous ! Terrain 12 · 15 h 40 · contre l'équipe 27 (Dupont / Martin)");
  });
  it("leaves unknown placeholders", () => {
    expect(formatTemplate("{a} {b}", { a: 1 })).toBe("1 {b}");
  });
});

describe("pétanque « d'office » message", () => {
  it("names the round skipped first, with or without the bracket", () => {
    expect(formatTemplate(petanque.notifications.office, { round: "cadrage" })).toBe("cadrage : qualifiés d'office pour le tour suivant, pas de partie à jouer.");
    expect(formatTemplate(petanque.notifications.office, { round: "concours B, cadrage" })).toBe(
      "concours B, cadrage : qualifiés d'office pour le tour suivant, pas de partie à jouer.",
    );
  });
});
