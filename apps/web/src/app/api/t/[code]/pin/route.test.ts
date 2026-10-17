import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** B3: no PIN session on a closed or purged tournament (403, not counted as a failed attempt). */

let row: Record<string, unknown> | null = null;
const rateLimit = vi.fn(async () => true);
const rpc = vi.fn();
vi.mock("@/lib/tournament/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    findTournamentRow: async () => row,
    json: (body: unknown, status = 200) => NextResponse.json(body, { status }),
    clientIp: () => "1.2.3.4",
    rateLimit,
    rateLimited: async () => false,
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/tournament/staff", () => ({ pinCookieName: (c: string) => `os_pin_${c}`, signPinSession: async () => ({ value: "v", maxAge: 1 }) }));

const { POST } = await import("./route");

const send = () =>
  POST(new NextRequest("http://localhost/api/t/FAN2/pin", { method: "POST", body: JSON.stringify({ pin: "4821" }) }), {
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
