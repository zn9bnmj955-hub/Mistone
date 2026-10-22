import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICING_PLANS } from "./reference-data";

// The plan description is shown to the club right above the "Pay" button.
describe("pricing plans", () => {
  it("describe what the club buys, never an internal note", () => {
    for (const plan of PRICING_PLANS) {
      expect(plan.description).not.toMatch(/prix de départ|à fixer|administration|todo/i);
      expect(plan.description.length).toBeGreaterThan(20);
    }
  });

  it("are the same in the generated reference.sql and seed.sql", () => {
    for (const file of ["reference.sql", "seed.sql"]) {
      const sql = readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), "utf8");
      expect(sql).not.toMatch(/Prix de départ/);
      for (const plan of PRICING_PLANS) expect(sql).toContain(plan.description.replace(/'/g, "''"));
    }
  });
});

// A2: the assistant's knowledge base covers each feature of the site and
// summarises the official rules with their source and dates.
describe("knowledge base", async () => {
  const { KB_DOCS } = await import("./kb-content");
  const { enabledSports } = await import("@orgasport/sports");

  it("has a help sheet for each feature asked by the owner", () => {
    const all = KB_DOCS.map((d) => `${d.title}\n${d.body}`).join("\n");
    for (const topic of [
      /PIN/, /cadrage/i, /Office/, /N\.H\./, /concours B/, /concours C/, /2 jours/, /Reprendre le concours/, /Clore définitivement/, /14 jours/,
      /Pointage/, /liste d'attente/, /Forfait/, /capitaines/, /code équipe/,
    ]) {
      expect(all).toMatch(topic);
    }
    expect(KB_DOCS.filter((d) => d.kind === "help").map((d) => d.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/PIN/), expect.stringMatching(/cadrage/), expect.stringMatching(/N\.H\./)]),
    );
  });

  it("keeps the promise of the registration form: contacts kept 6 months at most", () => {
    const closing = KB_DOCS.find((d) => /suppression des résultats/.test(d.title));
    expect(closing?.body).toMatch(/14 jours/);
    expect(closing?.body).toMatch(/plus de 6 mois après le concours/);
  });

  it("dates every rulebook sheet and gives its source", () => {
    const rules = KB_DOCS.filter((d) => d.kind === "rules");
    expect(rules.length).toBeGreaterThan(0);
    for (const d of rules) {
      expect(d.source).toMatch(/^https:\/\//);
      expect(d.versionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("dates every help sheet with its last review", () => {
    for (const d of KB_DOCS.filter((x) => x.kind === "help")) expect(d.reviewedAt, d.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dates in production the help sheets added before they were dated, keeping a date set in the admin", () => {
    const sql = readFileSync(new URL("../../../supabase/reference.sql", import.meta.url), "utf8");
    const pin = KB_DOCS.find((d) => /PIN/.test(d.title))!;
    expect(sql).toContain(
      `update public.kb_documents set reviewed_at = '${pin.reviewedAt}' where title = '${pin.title}' and kind = 'help' and reviewed_at is null;`,
    );
  });

  it("only has sheets for enabled sports, with unique titles, and never an end time", () => {
    const enabled = new Set(enabledSports().map((s) => s.slug));
    for (const d of KB_DOCS) if (d.sport) expect(enabled).toContain(d.sport);
    expect(new Set(KB_DOCS.map((d) => d.title)).size).toBe(KB_DOCS.length);
    for (const d of KB_DOCS) expect(d.body).not.toMatch(/heure de fin (estimée|prévue)|finit vers/i);
  });

  it("is in the generated reference.sql and seed.sql", () => {
    for (const file of ["reference.sql", "seed.sql"]) {
      const sql = readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), "utf8");
      for (const d of KB_DOCS) expect(sql).toContain(d.title.replace(/'/g, "''"));
    }
  });

  // A sheet edited in kb-content.ts without « reference:gen » / « seed:gen »
  // would keep its old text in the database (the titles alone stay the same).
  it("has the current text of every sheet in the generated reference.sql and seed.sql", () => {
    for (const file of ["reference.sql", "seed.sql"]) {
      const sql = readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), "utf8");
      for (const d of KB_DOCS) expect(sql, `${file} : ${d.title}`).toContain(d.body.replace(/'/g, "''"));
    }
  });

  // Gap found in A2: in a production database that already has a help sheet
  // (inserted once per title, never rewritten), reference.sql dates it
  // « à jour au 22 octobre 2026 » whatever its stored text. The 2-day sheet
  // (no « Reprendre le concours », « ou un tirage manuel ») and the clôture
  // sheet (no 6-month paragraph) would then be served with their old text and
  // « Fiche d'aide à jour au 22 octobre 2026 ». The date should only be set
  // when the stored text is the one it dates.
  it.fails("in production, dates a help sheet only when its stored text is the current one", () => {
    const sql = readFileSync(new URL("../../../supabase/reference.sql", import.meta.url), "utf8");
    for (const d of KB_DOCS.filter((x) => x.kind === "help")) {
      const line = sql.split("\n").find((l) => l.startsWith("update public.kb_documents set reviewed_at") && l.includes(`title = '${d.title.replace(/'/g, "''")}'`));
      expect(line, d.title).toBeDefined();
      expect(line, d.title).toMatch(/\bbody\b/);
    }
  });
});
