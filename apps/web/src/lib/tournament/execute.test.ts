import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand, createIdGenerator, type EngineState } from "@orgasport/engine";
import { makeState, playToEnd } from "../../../../../packages/engine/src/test-helpers";

/**
 * executeCommand / undoAction against a fake database: checks what is sent
 * to apply_tournament_changes (finished_at) and the refusals once closed.
 */
let current: EngineState;
const rpcCalls: { p_changes: { table: string; values?: Record<string, unknown> }[] }[] = [];
let actions: Record<string, unknown>[] = [];
let currentMeta: Record<string, unknown> = {};

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/env", () => ({ env: { supabaseUrl: "http://localhost" } }));
vi.mock("@/lib/notifications/server", () => ({ notifyFromChanges: async () => {} }));
vi.mock("./load", () => ({
  loadTournament: async () => ({ meta: { id: "t1", ...currentMeta }, version: 7, state: current }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (_fn: string, args: (typeof rpcCalls)[number]) => {
      rpcCalls.push(args);
      return { data: { version: 8, action_id: 99, duplicate: false }, error: null };
    },
    from: () => {
      const filters: [string, unknown][] = [];
      const run = () => actions.filter((a) => filters.every(([k, v]) => a[k] === v));
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        gt: () => q,
        is: () => q,
        neq: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return q;
    },
  }),
}));

const { executeCommand, undoAction, stampFinishedAt } = await import("./execute");

const OP = "11111111-1111-4111-a111-111111111111";
const staff = { kind: "account" as const, userId: "u1", staffId: null, label: "Orga", canManageAccess: true };

function finishedState(): EngineState {
  const s = playToEnd(makeState({ teams: 4, status: "live", config: { consolation: { enabled: false } } }), "b2");
  expect(s.tournament.status).toBe("finished");
  return s;
}
function finalMatch(s: EngineState) {
  const rounds = Object.values(s.rounds).filter((r) => r.bracket === "main");
  const last = rounds.reduce((a, b) => (b.number > a.number ? b : a));
  return Object.values(s.matches).find((m) => m.roundId === last.id && m.status === "done")!;
}
const tournamentValues = () => rpcCalls.at(-1)!.p_changes.find((c) => c.table === "tournaments")?.values;

beforeEach(() => {
  rpcCalls.length = 0;
  actions = [];
  currentMeta = {};
});

describe("finished_at", () => {
  it("is written when the final result finishes the tournament", async () => {
    const done = finishedState();
    const final = finalMatch(done);
    current = applyCommand(done, { type: "match.reopen", matchId: final.id }, { now: "2026-10-12T18:00:00.000Z", newId: createIdGenerator("r"), seed: "r" }).state;
    expect(current.tournament.status).toBe("live");
    const at = new Date(Date.now() - 60_000).toISOString();
    const res = await executeCommand({ code: "ABCD", command: { type: "match.score", matchId: final.id, scoreA: 13, scoreB: 5 }, clientOpId: OP, at, actor: staff });
    expect(res.ok).toBe(true);
    expect(tournamentValues()).toEqual({ status: "finished", finished_at: at });
  });

  it("is cleared when a correction brings the tournament back to play", async () => {
    current = finishedState();
    const res = await executeCommand({ code: "ABCD", command: { type: "match.reopen", matchId: finalMatch(current).id }, clientOpId: OP, actor: staff });
    expect(res.ok).toBe(true);
    expect(tournamentValues()).toEqual({ status: "live", finished_at: null });
  });

  it("is kept when the tournament is closed", async () => {
    current = finishedState();
    const res = await executeCommand({ code: "ABCD", command: { type: "tournament.close" }, clientOpId: OP, actor: staff });
    expect(res.ok).toBe(true);
    expect(tournamentValues()).toEqual({ status: "archived" });
  });

  it("is cleared when the final result is undone (undo goes through the same write)", async () => {
    const done = finishedState();
    const final = finalMatch(done);
    const live = applyCommand(done, { type: "match.reopen", matchId: final.id }, { now: "2026-10-12T18:00:00.000Z", newId: createIdGenerator("r"), seed: "r" }).state;
    const scored = applyCommand(live, { type: "match.score", matchId: final.id, scoreA: 13, scoreB: 5 }, { now: "2026-10-12T18:05:00.000Z", newId: createIdGenerator("s"), seed: "s" });
    expect(scored.state.tournament.status).toBe("finished");
    current = scored.state;
    actions = [{ id: 12, tournament_id: "t1", type: "match.score", changes: scored.changes, undone_at: null }];
    const res = await undoAction({ code: "ABCD", actionId: 12, clientOpId: OP, actor: staff });
    expect(res.ok).toBe(true);
    expect(tournamentValues()).toEqual({ status: "live", finished_at: null });
  });

  it("stampFinishedAt leaves other changes alone", () => {
    const changes = [{ table: "matches" as const, op: "update" as const, key: "id" as const, id: "m", values: { score_a: 13 } }];
    expect(stampFinishedAt(changes, "live", "finished", "2026-10-16T10:00:00.000Z")).toEqual(changes);
    expect(stampFinishedAt(changes, "live", "live", "x")).toBe(changes);
  });
});

describe("finished tournament: corrections only", () => {
  it("accepts a score correction (forfeit of the final's winner) and stays finished", async () => {
    current = finishedState();
    const final = finalMatch(current);
    const res = await executeCommand({ code: "ABCD", command: { type: "match.forfeit", matchId: final.id, side: final.winner === "A" ? "A" : "B" }, clientOpId: OP, actor: staff });
    expect(res.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    // Still finished: finished_at is not touched (the 24 h keep counting from the final).
    expect(tournamentValues()).toBeUndefined();
  });

  it("accepts a new score for the final (winner changed) and stays finished, finished_at untouched", async () => {
    current = finishedState();
    const final = finalMatch(current);
    const flipped = final.winner === "A" ? { scoreA: 5, scoreB: 13 } : { scoreA: 13, scoreB: 5 };
    const res = await executeCommand({ code: "ABCD", command: { type: "match.score", matchId: final.id, ...flipped }, clientOpId: OP, actor: staff });
    expect(res.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    const matchValues = rpcCalls[0]!.p_changes.find((c) => c.table === "matches")?.values;
    expect(matchValues).toMatchObject({ score_a: flipped.scoreA, score_b: flipped.scoreB });
    expect(tournamentValues()).toBeUndefined();
  });

  it("refuses anything else (TOURNAMENT_FINISHED)", async () => {
    current = finishedState();
    const res = await executeCommand({ code: "ABCD", command: { type: "round.draw", bracket: "main", seed: "x" }, clientOpId: OP, actor: staff });
    expect(res).toMatchObject({ ok: false, error: { code: "TOURNAMENT_FINISHED" }, status: 422 });
  });
});

describe("closed tournament (archived)", () => {
  function archived() {
    const s = finishedState();
    return applyCommand(s, { type: "tournament.close" }, { now: "2026-10-13T18:00:00.000Z", newId: createIdGenerator("c"), seed: "c" }).state;
  }

  it("refuses every command, corrections included", async () => {
    current = archived();
    const res = await executeCommand({ code: "ABCD", command: { type: "match.reopen", matchId: finalMatch(current).id }, clientOpId: OP, actor: staff });
    expect(res).toEqual({ ok: false, error: { code: "TOURNAMENT_ARCHIVED" }, status: 422 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses undo, without reading the history", async () => {
    current = archived();
    actions = [{ id: 5, tournament_id: "t1", type: "match.score", changes: [], undone_at: null }];
    const res = await undoAction({ code: "ABCD", actionId: 5, clientOpId: OP, actor: staff });
    expect(res).toEqual({ ok: false, error: { code: "TOURNAMENT_ARCHIVED" }, status: 422 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("still answers a retried operation applied before the close", async () => {
    current = archived();
    actions = [{ id: 42, tournament_id: "t1", client_op_id: OP, state_version: 6 }];
    const res = await executeCommand({ code: "ABCD", command: { type: "tournament.close" }, clientOpId: OP, actor: null, source: "system" });
    expect(res).toMatchObject({ ok: true, duplicate: true, actionId: 42 });
  });
});

describe("purged tournament (B3, safety net at 6 months)", () => {
  // The purge also takes a published tournament started more than 6 months ago, without
  // closing it (status stays 'published'). Once purged_at is set the purge never runs again
  // on it, so any new team or player written afterwards would be kept forever.
  // The purge now archives it too; executeCommand also refuses on purged_at (defence in depth).
  it("refuses a new team on a purged tournament that was never closed", async () => {
    current = makeState({ teams: 4, status: "published" });
    currentMeta = { purged_at: "2026-10-01T03:23:00.000Z" };
    const res = await executeCommand({
      code: "ABCD",
      command: { type: "team.create", players: [{ firstName: "Jean", lastName: "Dupont" }], source: "online" },
      clientOpId: OP,
      actor: null,
      source: "online",
    });
    expect(res).toEqual({ ok: false, error: { code: "TOURNAMENT_ARCHIVED" }, status: 422 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses undo on a purged tournament", async () => {
    current = makeState({ teams: 4, status: "live" });
    currentMeta = { purged_at: "2026-10-01T03:23:00.000Z" };
    actions = [{ id: 5, tournament_id: "t1", type: "match.score", changes: [], undone_at: null }];
    const res = await undoAction({ code: "ABCD", actionId: 5, clientOpId: OP, actor: staff });
    expect(res).toEqual({ ok: false, error: { code: "TOURNAMENT_ARCHIVED" }, status: 422 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("still answers a retried operation applied before the purge", async () => {
    current = makeState({ teams: 4, status: "live" });
    currentMeta = { purged_at: "2026-10-01T03:23:00.000Z" };
    actions = [{ id: 42, tournament_id: "t1", client_op_id: OP, state_version: 6 }];
    const res = await executeCommand({ code: "ABCD", command: { type: "round.draw", bracket: "main", seed: "x" }, clientOpId: OP, actor: staff });
    expect(res).toMatchObject({ ok: true, duplicate: true, actionId: 42 });
    expect(rpcCalls).toHaveLength(0);
  });
});
