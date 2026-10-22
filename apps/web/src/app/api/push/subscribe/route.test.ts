import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B3: once a tournament is purged (purged_at set), nothing new may be attached to it —
 * a push subscription following it would never be deleted (the purge never runs twice).
 */

let tournament: Record<string, unknown> | null = null;
const writes: { table: string; op: string; values: unknown }[] = [];

function query(table: string) {
  const q = {
    select: () => q,
    eq: () => q,
    neq: () => q,
    maybeSingle: async () => {
      if (table === "tournaments") return { data: tournament };
      if (table === "teams") return { data: { id: "team-1" } };
      return { data: null };
    },
    single: async () => ({ data: { id: "sub-1" }, error: null }),
    insert: (values: unknown) => (writes.push({ table, op: "insert", values }), q),
    update: (values: unknown) => (writes.push({ table, op: "update", values }), q),
    upsert: async (values: unknown) => (writes.push({ table, op: "upsert", values }), { error: null }),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: null }) } }) }));
vi.mock("@/lib/tournament/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
    clientIp: () => "1.2.3.4",
    rateLimit: async () => true,
  };
});

const { POST } = await import("./route");

const send = () =>
  POST(
    new NextRequest("http://localhost/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        subscription: { endpoint: "https://push.example.com/abc", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } },
        code: "PRG2",
        team: 3,
      }),
    }),
  );

describe("POST /api/push/subscribe and the purge (B3)", () => {
  beforeEach(() => {
    writes.length = 0;
  });

  it("follows a team of a tournament that is not purged", async () => {
    tournament = { id: "t1", status: "live", purged_at: null };
    const res = await send();
    expect(res.status).toBe(200);
    expect(writes.some((w) => w.table === "push_targets" && w.op === "upsert")).toBe(true);
  });

  it("refuses a purged tournament and stores nothing (device, follow)", async () => {
    tournament = { id: "t1", status: "archived", purged_at: "2026-10-01T03:23:00.000Z" };
    const res = await send();
    expect(res.status).toBe(410);
    expect(writes.filter((w) => w.table === "push_subscriptions" || w.table === "push_targets")).toEqual([]);
  });

  it("refuses a closed (archived) tournament not yet purged", async () => {
    tournament = { id: "t1", status: "archived", purged_at: null };
    const res = await send();
    expect(res.status).toBe(410);
    expect(writes).toEqual([]);
  });
});
