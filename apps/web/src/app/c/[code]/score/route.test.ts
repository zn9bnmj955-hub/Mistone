import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Lot 2, T5: a captain's score on a finished or closed tournament is refused with a clear message (no 500). */

let status = "live";
let purgedAt: string | null = null;
/** In-memory hit_rate_limit / refund_rate_limit (atomic in SQL; sequential here). */
const hits = new Map<string, number>();
const executeCommand = vi.fn();
const insert = vi.fn();
vi.mock("@/lib/tournament/load", () => ({
  loadTournament: async () => ({
    meta: { id: "t1", purged_at: purgedAt },
    state: {
      tournament: { status, config: { scoreEntry: "captains" } },
      teams: { a: { id: "a", number: 3 }, b: { id: "b", number: 4 } },
      teamSecrets: { a: { code: "4821" }, b: { code: "1357" } },
    },
  }),
}));
// Past the code check, the match lookup is not under test: "no current match".
vi.mock("@/terrain/view-model", () => ({ currentMatch: () => null, teamTimeline: () => [] }));
vi.mock("@/lib/tournament/execute", () => ({ executeCommand }));
vi.mock("@/lib/tournament/http", () => ({
  clientIp: (r: NextRequest) => r.headers.get("x-real-ip") ?? "1.2.3.4",
  rateLimit: async (key: string, max: number) => {
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    return n <= max;
  },
  refundRateLimit: async (key: string) => {
    hits.set(key, Math.max(0, (hits.get(key) ?? 0) - 1));
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

const { POST } = await import("./route");

const send = (o: { ip?: string; equipe?: string; code?: string } = {}) =>
  POST(
    new NextRequest("http://localhost/c/FAN2/score", {
      method: "POST",
      headers: { "x-real-ip": o.ip ?? "1.2.3.4" },
      body: new URLSearchParams({ equipe: o.equipe ?? "3", us: "13", them: "7", code: o.code ?? "1234" }),
    }),
    { params: Promise.resolve({ code: "FAN2" }) },
  );
const msgOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("msg");

describe("POST /c/CODE/score after the end", () => {
  beforeEach(() => {
    executeCommand.mockReset();
    insert.mockReset();
    hits.clear();
    purgedAt = null;
  });

  it.each([
    ["finished", "ended"],
    ["archived", "closed"],
  ])("%s: back to the page with msg=%s, nothing written", async (s, msg) => {
    status = s;
    const res = await send();
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe("/c/FAN2");
    expect(url.searchParams.get("msg")).toBe(msg);
    expect(url.searchParams.get("equipe")).toBe("3");
    expect(executeCommand).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("purged (B3, never closed): back to the page with msg=closed, nothing written", async () => {
    status = "live";
    purgedAt = "2026-10-01T03:23:00.000Z";
    const res = await send();
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("msg")).toBe("closed");
    expect(executeCommand).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("POST /c/CODE/score: wrong team codes (audit 32)", () => {
  beforeEach(() => {
    status = "live";
    purgedAt = null;
    hits.clear();
    insert.mockReset();
  });

  it("the 11th wrong code on the same team is refused, even from another address", async () => {
    for (let i = 1; i <= 10; i++) expect(msgOf(await send({ ip: `10.0.0.${i}`, code: String(1000 + i) }))).toBe("badCode");
    expect(msgOf(await send({ ip: "2001:db8:9::/64", code: "9999" }))).toBe("teamLocked");
    // Past the cap even the right code waits (or guessing would go on): the scoring table takes the score.
    expect(msgOf(await send({ ip: "192.0.2.7", code: "4821" }))).toBe("teamLocked");
    expect(insert).not.toHaveBeenCalled();
    // Another team is not affected.
    expect(msgOf(await send({ ip: "192.0.2.7", equipe: "4", code: "1357" }))).toBe("notPlayable");
  });

  it("only failures count: right codes are given back", async () => {
    for (let i = 0; i < 25; i++) expect(msgOf(await send({ ip: `10.1.0.${i}`, code: "4821" }))).toBe("notPlayable");
    for (let i = 0; i < 9; i++) expect(msgOf(await send({ ip: `10.2.0.${i}`, code: "0000" }))).toBe("badCode");
    expect(msgOf(await send({ ip: "10.3.0.1", code: "4821" }))).toBe("notPlayable");
    expect(msgOf(await send({ ip: "10.3.0.2", code: "0000" }))).toBe("badCode");
    expect(msgOf(await send({ ip: "10.3.0.3", code: "0000" }))).toBe("teamLocked");
  });

  it("parallel wrong codes: at most 10 are checked", async () => {
    const all = await Promise.all(Array.from({ length: 30 }, (_, i) => send({ ip: `10.4.0.${i}`, code: String(2000 + i) })));
    expect(all.filter((r) => msgOf(r) === "badCode")).toHaveLength(10);
    expect(all.filter((r) => msgOf(r) === "teamLocked")).toHaveLength(20);
  });

  it("the per-device limit still applies (20 per 15 min)", async () => {
    for (let i = 0; i < 20; i++) await send({ ip: "198.51.100.1", code: "4821" });
    expect(msgOf(await send({ ip: "198.51.100.1", code: "4821" }))).toBe("limited");
  });
});
