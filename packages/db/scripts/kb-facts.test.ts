import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { C_MIN_B_TEAMS, defaultTournamentConfig, eliminationDrawPlan } from "@orgasport/engine";
import { requireSport } from "@orgasport/sports";
import { KB_DOCS } from "./kb-content";

/**
 * A2: the help sheets state numbers that the engine, the form and the database
 * decide (exempt 13-7, cadrage, C, pause, clôture 24 h, suppression 14 jours,
 * 6 mois). The assistant repeats them to clubs and players: when the code
 * changes and the sheet does not, this test fails.
 */
const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const sheet = (title: RegExp) => {
  const d = KB_DOCS.find((x) => title.test(x.title));
  expect(d, String(title)).toBeDefined();
  return d!.body;
};
const petanque = defaultTournamentConfig(requireSport("petanque"));

describe("help sheets follow the real behaviour of the site (A2)", () => {
  it("exempt 13 à 7 and forfeit 13 à 0, as in the pétanque defaults, in every sheet that mentions them", () => {
    expect(petanque.byeScore).toEqual({ winner: 13, loser: 7 });
    expect(petanque.forfeitScore).toEqual({ winner: 13, loser: 0 });
    const bye = `${petanque.byeScore.winner} à ${petanque.byeScore.loser}`;
    const forfeit = `${petanque.forfeitScore.winner} à ${petanque.forfeitScore.loser}`;
    let byes = 0;
    let forfeits = 0;
    for (const d of KB_DOCS) {
      for (const p of d.body.split(/\n\n/)) {
        if (/\bexempte?\b/i.test(p) && /gagne/.test(p)) {
          byes++;
          expect(p, d.title).toContain(bye);
        }
        for (const s of p.split(/(?<=\.) /)) {
          if (/forfait/.test(s) && /\d+ à \d+/.test(s) && !/exempt/i.test(s)) {
            forfeits++;
            expect(s, d.title).toContain(forfeit);
          }
        }
      }
    }
    expect(byes).toBeGreaterThanOrEqual(3);
    expect(forfeits).toBeGreaterThanOrEqual(2);
  });

  it("cadrage after the 1st game by default, or the 2nd", () => {
    expect(petanque.cadrage.afterRound).toBe(1);
    expect(sheet(/cadrage et les qualifiés/)).toMatch(/après la 1re partie \(par défaut\) ou après la 2e/);
  });

  it("the cadrage examples of the sheet are those the engine draws", () => {
    const body = sheet(/cadrage et les qualifiés/);
    // « 13 équipes donnent 6 parties et 1 exempt, il en reste 7 ; puis cadrage de 3 parties et 1 d'office, il en reste 4. »
    const ex13 = /(\d+) équipes donnent (\d+) parties et (\d+) exempt, il en reste (\d+) ; puis cadrage de (\d+) parties et (\d+) d'office, il en reste (\d+)/.exec(body)!;
    expect(ex13).not.toBeNull();
    const [T, games, exempt, left, cg, office, final] = ex13.slice(1).map(Number) as [number, number, number, number, number, number, number];
    expect(eliminationDrawPlan(T, 0, 1, false)).toMatchObject({ matches: games, exempt, office: 0 });
    expect(left).toBe(games + exempt);
    expect(eliminationDrawPlan(left, 1, 1, false)).toMatchObject({ matches: cg, office, kind: "cadrage" });
    expect(final).toBe(cg + office);
    // « Avec 100 équipes, il en reste 50, puis 18 parties de cadrage et 14 d'office, il en reste 32. »
    const ex100 = /Avec (\d+) équipes, il en reste (\d+), puis (\d+) parties de cadrage et (\d+) d'office, il en reste (\d+)/.exec(body)!;
    expect(ex100).not.toBeNull();
    const [T2, left2, cg2, office2, final2] = ex100.slice(1).map(Number) as [number, number, number, number, number];
    expect(eliminationDrawPlan(T2, 0, 1, false)).toMatchObject({ matches: left2, exempt: 0 });
    expect(eliminationDrawPlan(left2, 1, 1, false)).toMatchObject({ matches: cg2, office: office2, kind: "cadrage" });
    expect(final2).toBe(cg2 + office2);
    // « s'il reste par exemple 7 équipes, 3 parties se jouent (6 équipes) et 1 équipe est qualifiée d'office »
    const ex7 = /s'il reste par exemple (\d+) équipes, (\d+) parties se jouent \((\d+) équipes\) et (\d+) équipe est qualifiée d'office/.exec(body)!;
    expect(ex7).not.toBeNull();
    expect(eliminationDrawPlan(Number(ex7[1]), 1, 1, false)).toMatchObject({ matches: Number(ex7[2]), office: Number(ex7[4]) });
  });

  it("the C needs a B of at least 4 teams, as in the engine", () => {
    expect(sheet(/concours B et C/)).toContain(`si le B compte au moins ${C_MIN_B_TEAMS} équipes au départ`);
  });

  it("the pause points of the 2-day sheet are the choices of the form", () => {
    const schema = read("apps/web/src/lib/tournament-form/schema.ts");
    const pauses = /export const PAUSES = \[([^\]]+)\]/.exec(schema)![1]!;
    expect(pauses.replace(/\s/g, "")).toBe(`"none","before32","before16","before8","before4","afterPools"`);
    expect(sheet(/2 jours/)).toContain("avant les 1/16, les 1/8, les 1/4, les 1/2, ou après les poules");
  });

  it("automatic closing 24 h after the final, results deleted 14 days later, contacts kept 6 months at most", () => {
    const hours = Number(/AUTO_CLOSE_AFTER_MS = (\d+) \* 3600_000/.exec(read("apps/web/src/lib/tournament/auto-close.ts"))![1]);
    const purge = readdirSync(new URL("supabase/migrations/", root))
      .filter((f) => /purge/.test(f))
      .sort()
      .map((f) => read(`supabase/migrations/${f}`))
      .at(-1)!;
    const days = Number(/finished_at <= p_now - interval '(\d+) days'/.exec(purge)![1]);
    const months = Number(/<= p_now - interval '(\d+) months'/.exec(purge)![1]);
    const body = sheet(/clôture du concours/);
    expect(body).toContain(`automatiquement ${hours} h après la finale`);
    expect(body).toContain(`Les résultats restent visibles ${days} jours après la fin du concours`);
    expect(body).toContain(`plus de ${months} mois après le concours`);
  });
});
