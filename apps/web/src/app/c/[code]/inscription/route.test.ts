import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSport } from "@orgasport/sports";

/** Lot 2, T5: a registration sent to a finished or closed tournament is refused with a clear message (no 500). */

vi.mock("server-only", () => ({}));
let status = "finished";
let purgedAt: string | null = null;
const registerOnline = vi.fn();
const rateLimit = vi.fn(async () => true);
vi.mock("@/lib/tournament/load", () => ({
  loadTournament: async () => ({
    meta: {
      id: "t1", short_code: "FAN2", name: "Concours fini", status, starts_at: "2026-10-12T12:00:00Z", registration_mode: "online",
      registration_closes_at: null, max_teams: null, waitlist_enabled: false, team_format: "doublette", eligibility: "open",
      category: "all", config: {}, name_display: "full", fee_cents: 0, fee_per: "team", club: null, rules_pdf_path: null, purged_at: purgedAt,
    },
    sport: requireSport("petanque"),
    state: { teams: {} },
  }),
}));
vi.mock("@/lib/tournament/register", async (orig) => ({ ...(await orig<typeof import("@/lib/tournament/register")>()), registerOnline }));
vi.mock("@/lib/tournament/http", () => ({ clientIp: () => "1.2.3.4", rateLimit }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: null }) } }) }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => ({}) }));
vi.mock("@/lib/turnstile", () => ({ turnstileSiteKey: () => null, verifyTurnstile: async () => true }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const { POST } = await import("./route");

const send = () =>
  POST(
    new NextRequest("http://localhost/c/FAN2/inscription", { method: "POST", body: "f_cap=L%C3%A9a&f_rules=on", headers: { "content-type": "application/x-www-form-urlencoded" } }),
    { params: Promise.resolve({ code: "FAN2" }) },
  );

describe("POST /c/CODE/inscription after the end", () => {
  beforeEach(() => {
    registerOnline.mockReset();
    rateLimit.mockClear();
    purgedAt = null;
  });

  it.each([
    ["finished", "Ce concours est terminé"],
    ["archived", "Lien clôturé"],
  ])("%s: 409 with the reason, no form, nothing registered", async (s, text) => {
    status = s;
    const res = await send();
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain(text);
    expect(body).not.toContain("<form");
    expect(registerOnline).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("purged (B3) while still published: 409, closed link, nothing registered", async () => {
    status = "published";
    purgedAt = "2026-10-01T03:23:00.000Z";
    const res = await send();
    expect(res.status).toBe(409);
    const body = await res.text();
    expect(body).toContain("Lien clôturé");
    expect(body).not.toContain("<form");
    expect(registerOnline).not.toHaveBeenCalled();
  });
});
