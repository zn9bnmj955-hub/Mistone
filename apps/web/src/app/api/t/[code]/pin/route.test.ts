import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** B3: no PIN session on a closed or purged tournament (403, not counted as a failed attempt). */

let row: Record<string, unknown> | null = null;
let ip = "1.2.3.4";
// In-memory version of hit_rate_limit / refund_rate_limit (atomic in SQL).
const counts = new Map<string, number>();
const rateLimit = vi.fn(async (key: string, max: number) => {
  const n = (counts.get(key) ?? 0) + 1;
  counts.set(key, n);
  return n <= max;
});
const refundRateLimit = vi.fn(async (key: string) => {
  const n = counts.get(key) ?? 0;
  if (n > 0) counts.set(key, n - 1);
});
const rpc = vi.fn();
vi.mock("@/lib/tournament/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    findTournamentRow: async () => row,
    json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
    clientIp: () => ip,
    rateLimit,
    refundRateLimit,
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/tournament/staff", () => ({ pinCookieName: (c: string) => `os_pin_${c}`, signPinSession: async () => ({ value: "v", maxAge: 1 }) }));

const { POST } = await import("./route");

const send = (pin = "4821") =>
  POST(new NextRequest("http://localhost/api/t/FAN2/pin", { method: "POST", body: JSON.stringify({ pin }) }), {
    params: Promise.resolve({ code: "FAN2" }),
  });

describe("POST /api/t/CODE/pin on a closed or purged tournament", () => {
  beforeEach(() => {
    rateLimit.mockClear();
    rpc.mockReset();
  });

  it.each([
    ["archived", null],
    ["live", "2026-10-01T03:23:00.000Z"],
  ])("status %s, purged_at %s: 403 TOURNAMENT_ARCHIVED, PIN not checked", async (status, purged_at) => {
    row = { id: "t1", short_code: "FAN2", status, purged_at };
    const res = await send();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "TOURNAMENT_ARCHIVED" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("POST /api/t/CODE/pin: brute-force protection", () => {
  const verified = () => rpc.mock.calls.filter(([fn]) => fn === "verify_staff_pin").length;
  beforeEach(() => {
    row = { id: "t1", short_code: "FAN2", status: "live", purged_at: null };
    ip = "1.2.3.4";
    counts.clear();
    rateLimit.mockClear();
    rpc.mockReset();
    // Right PIN: 4821. Slow enough for parallel requests to interleave.
    rpc.mockImplementation(async (_fn: string, args: { p_pin: string }) => {
      await new Promise((r) => setTimeout(r, 5));
      return { data: args.p_pin === "4821" ? "s1" : null };
    });
  });

  it("the 9th attempt of a device gets 429 without checking the PIN", async () => {
    for (let i = 0; i < 8; i++) expect((await send("0000")).status).toBe(401);
    const res = await send("4821");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "RATE_LIMITED" } });
    expect(verified()).toBe(8);
  });

  it("parallel requests from one device never get more than 8 guesses", async () => {
    const res = await Promise.all(Array.from({ length: 30 }, () => send("0000")));
    expect(verified()).toBe(8);
    expect(res.filter((r) => r.status === 401)).toHaveLength(8);
    expect(res.filter((r) => r.status === 429)).toHaveLength(22);
  });

  it("a right PIN is accepted after 60 failures from other devices", async () => {
    for (let d = 0; d < 10; d++) {
      ip = `10.0.0.${d}`;
      for (let i = 0; i < 8; i++) await send("0000");
    }
    expect(counts.get("pinfail:t1")).toBeGreaterThan(60);
    ip = "5.6.7.8";
    const res = await send("4821");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("os_pin_FAN2=v");
  });

  it("under attack (more than 60 failures), each new failure costs the device 3 attempts", async () => {
    counts.set("pinfail:t1", 60);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await send("0000")).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it("a successful attempt is not counted", async () => {
    for (let i = 0; i < 7; i++) await send("0000");
    for (let i = 0; i < 5; i++) expect((await send("4821")).status).toBe(200);
    expect(counts.get("pinfail:t1:1.2.3.4")).toBe(7);
    expect(counts.get("pinfail:t1")).toBe(7);
    expect((await send("0000")).status).toBe(401);
    expect((await send("4821")).status).toBe(429);
  });
});
