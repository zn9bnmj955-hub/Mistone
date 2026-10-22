import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const kbRows = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      kbRows.calls.push(args);
      return { data: kbRows.rows, error: null };
    },
  }),
}));
vi.mock("@/lib/data/catalog", () => ({ listCatalog: async () => [], toCatalogQuery: () => ({}) }));
vi.mock("@/lib/data/tournaments", () => ({ getMyNextMatch: async () => null }));
vi.mock("@/lib/tournament/load", () => ({ loadTournament: async () => null }));

const { runTool, toolDefinitions, rulesCitation, helpUpdated } = await import("./tools");
const { formatLongDate } = await import("@/lib/format");
const { systemPrompt } = await import("./prompt");

const ctx = { viewer: null, origin: null, nowMs: Date.parse("2026-10-16T08:00:00Z"), siteUrl: "http://localhost" };

describe("assistant: no end time, no duration", () => {
  it("format_advice gives counts only", async () => {
    const res = await runTool("format_advice", { sport: "petanque", teams: 128, venues: 10, start_time: "14:00" }, ctx);
    expect(res.isError).toBe(false);
    const out = JSON.parse(res.content) as Record<string, unknown>;
    expect(out.venues_needed_first_round).toBeGreaterThan(10);
    expect(out).not.toHaveProperty("estimated_end");
    expect(res.content).not.toMatch(/end|fin|dur/i);
  });

  it("tells the model never to give an end time", () => {
    expect(systemPrompt()).toContain("Ne donne jamais d'heure de fin");
    const advice = toolDefinitions().find((t) => t.name === "format_advice");
    expect(advice?.description).not.toMatch(/heure de fin estimée/);
  });
});

describe("assistant: dated knowledge base (A2)", () => {
  const cadrage = {
    title: "Aide OrgaSport : le cadrage et les qualifiés d'office (Office)",
    sport_slug: "petanque",
    source_url: null,
    content: "Aide OrgaSport : le cadrage… — Le cadrage sert à arriver à un nombre d'équipes rond.",
    rank: 0.5,
    kind: "help",
    version_date: null,
    reviewed_at: null,
  };
  const pin = { ...cadrage, title: "Aide OrgaSport : le PIN des bénévoles", sport_slug: null, content: "Le PIN est un code à donner à un bénévole." };
  const rules = {
    title: "Pétanque : règlement officiel — but nul, boules nulles et mesure",
    sport_slug: "petanque",
    source_url: "https://www.ffpjp.org",
    content: "But nul : si le but sort du terrain…",
    rank: 0.4,
    kind: "rules",
    version_date: "2026-10-16",
    reviewed_at: "2026-10-16",
  };

  it("returns the cadrage and PIN help sheets, without a rulebook citation", async () => {
    kbRows.rows = [cadrage, pin];
    const res = await runTool("knowledge_search", { query: "comment marche le cadrage et le PIN" }, ctx);
    expect(res.isError).toBe(false);
    const out = JSON.parse(res.content) as { results: { title: string; kind: string; cite?: string }[] };
    expect(out.results.map((r) => r.title)).toEqual([cadrage.title, pin.title]);
    expect(out.results.every((r) => r.kind === "help" && r.cite === undefined)).toBe(true);
  });

  it("returns a rulebook sheet with its source and « règlement en vigueur au … »", async () => {
    kbRows.rows = [rules];
    const res = await runTool("knowledge_search", { query: "but nul", sport: "petanque" }, ctx);
    const out = JSON.parse(res.content) as { results: { source: string; cite: string }[] };
    expect(out.results[0]!.source).toBe("https://www.ffpjp.org");
    expect(out.results[0]!.cite).toBe("Règlement en vigueur au 16 octobre 2026 (source : https://www.ffpjp.org).");
    expect(kbRows.calls.at(-1)).toMatchObject({ p_query: "but nul", p_sport: "petanque" });
  });

  it("formats the version date in French and needs a date to cite", () => {
    expect(formatLongDate("2025-01-01")).toBe("1er janvier 2025");
    expect(formatLongDate("2026-10-16")).toBe("16 octobre 2026");
    expect(rulesCitation({ kind: "rules", version_date: "2025-01-01", source_url: null })).toBe("Règlement en vigueur au 1er janvier 2025.");
    expect(rulesCitation({ kind: "rules", version_date: null, source_url: "https://www.ffpjp.org" })).toBeNull();
    expect(rulesCitation({ kind: "help", version_date: "2025-01-01" })).toBeNull();
  });

  it("dates a help sheet « à jour au … » when it was reviewed, never as a rulebook", async () => {
    kbRows.rows = [{ ...pin, reviewed_at: "2026-10-22" }];
    const res = await runTool("knowledge_search", { query: "PIN" }, ctx);
    const out = JSON.parse(res.content) as { results: { cite?: string; updated?: string }[] };
    expect(out.results[0]!.updated).toBe("Fiche d'aide à jour au 22 octobre 2026.");
    expect(out.results[0]!.cite).toBeUndefined();
    expect(helpUpdated({ kind: "help", reviewed_at: null })).toBeNull();
    expect(helpUpdated({ kind: "rules", reviewed_at: "2026-10-16" })).toBeNull();
  });

  it("tells the model to cite the rulebook version", () => {
    expect(systemPrompt()).toContain("Règlement en vigueur au");
    expect(toolDefinitions().find((t) => t.name === "knowledge_search")?.description).toMatch(/PIN.*cadrage/);
  });
});
