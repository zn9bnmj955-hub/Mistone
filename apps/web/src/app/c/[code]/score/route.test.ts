import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Lot 2, T5: a captain's score on a finished or closed tournament is refused with a clear message (no 500). */

let status = "live";
let purgedAt: string | null = null;
const executeCommand = vi.fn();
const insert = vi.fn();
vi.mock("@/lib/tournament/load", () => ({
  loadTournament: async () => ({ meta: { id: "t1", purged_at: purgedAt }, state: { tournament: { status, config: { scoreEntry: "captains" } }, teams: {}, teamSecrets: {} } }),
}));
vi.mock("@/lib/tournament/execute", () => ({ executeCommand }));
vi.mock("@/lib/tournament/http", () => ({ clientIp: () => "1.2.3.4", rateLimit: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

const { POST } = await import("./route");

const send = () =>
  POST(
    new NextRequest("http://localhost/c/FAN2/score", { method: "POST", body: new URLSearchParams({ equipe: "3", us: "13", them: "7", code: "1234" }) }),
    { params: Promise.resolve({ code: "FAN2" }) },
  );

describe("POST /c/CODE/score after the end", () => {
  beforeEach(() => {
    executeCommand.mockReset();
    insert.mockReset();
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
