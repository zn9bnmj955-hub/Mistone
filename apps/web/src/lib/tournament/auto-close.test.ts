import { beforeEach, describe, expect, it, vi } from "vitest";

/** Automatic close by the minute tick: 24 h after the final, not before. */
type Row = { id: string; short_code: string | null; status: string; finished_at: string | null };
let rows: Row[] = [];
const commands: { code: string; clientOpId: string; command: unknown; source?: string }[] = [];
let failing = new Set<string>();

vi.mock("server-only", () => ({}));
vi.mock("./execute", () => ({
  executeCommand: async (args: (typeof commands)[number]) => {
    commands.push(args);
    if (failing.has(args.code)) return { ok: false, error: { code: "CONFLICT" }, status: 409 };
    return { ok: true, version: 1, actionId: 1, changes: [], duplicate: false };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select: () => q,
        eq: (k: keyof Row, v: unknown) => (filters.push((r) => r[k] === v), q),
        not: (k: keyof Row) => (filters.push((r) => r[k] != null), q),
        lte: (k: keyof Row, v: string) => (filters.push((r) => r[k] != null && Date.parse(r[k]!) <= Date.parse(v)), q),
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(ok),
      };
      return q;
    },
  }),
}));

const { closeExpiredTournaments, closeOpId } = await import("./auto-close");

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600_000;

beforeEach(() => {
  commands.length = 0;
  failing = new Set();
});

describe("closeExpiredTournaments", () => {
  it("closes 24 h after the final, not before", async () => {
    rows = [
      { id: "a0000000-0000-4000-8000-000000000001", short_code: "AAAA", status: "finished", finished_at: ago(24 * H + 60_000) },
      { id: "a0000000-0000-4000-8000-000000000002", short_code: "BBBB", status: "finished", finished_at: ago(24 * H - 60_000) },
      { id: "a0000000-0000-4000-8000-000000000003", short_code: "CCCC", status: "finished", finished_at: ago(24 * H) },
    ];
    expect(await closeExpiredTournaments(NOW)).toEqual(["AAAA", "CCCC"]);
    expect(commands.map((c) => c.code)).toEqual(["AAAA", "CCCC"]);
    expect(commands[0]).toMatchObject({ command: { type: "tournament.close" }, source: "system", clientOpId: closeOpId(rows[0]!.id) });
  });

  it("ignores tournaments already closed, still live, or without a final date", async () => {
    rows = [
      { id: "b1", short_code: "DDDD", status: "archived", finished_at: ago(48 * H) },
      { id: "b2", short_code: "EEEE", status: "live", finished_at: null },
      { id: "b3", short_code: "FFFF", status: "finished", finished_at: null },
    ];
    expect(await closeExpiredTournaments(NOW)).toEqual([]);
    expect(commands).toHaveLength(0);
  });

  it("a refused close is not reported and does not stop the others (retried at the next tick)", async () => {
    rows = [
      { id: "c1", short_code: "GGGG", status: "finished", finished_at: ago(30 * H) },
      { id: "c2", short_code: "HHHH", status: "finished", finished_at: ago(26 * H) },
      { id: "c3", short_code: null, status: "finished", finished_at: ago(25 * H) },
    ];
    failing = new Set(["GGGG"]);
    expect(await closeExpiredTournaments(NOW)).toEqual(["HHHH"]);
    expect(commands.map((c) => c.code)).toEqual(["GGGG", "HHHH"]);
    failing = new Set();
    commands.length = 0;
    expect(await closeExpiredTournaments(NOW)).toEqual(["GGGG", "HHHH"]);
    expect(commands[0]!.clientOpId).toBe(closeOpId("c1"));
  });

  it("uses a stable, valid operation id per tournament (two ticks close once)", () => {
    const id = closeOpId("a0000000-0000-4000-8000-000000000001");
    expect(id).toBe(closeOpId("a0000000-0000-4000-8000-000000000001"));
    expect(id).not.toBe(closeOpId("a0000000-0000-4000-8000-000000000002"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
