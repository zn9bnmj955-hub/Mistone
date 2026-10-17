import "server-only";
import {
  EngineError,
  applyChanges,
  applyCommand,
  canInvert,
  conflictsWithLater,
  createIdGenerator,
  invertChanges,
  type Change,
  type Command,
  type EngineState,
} from "@orgasport/engine";
import { toDbChanges, type DbChange } from "@orgasport/db";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { notifyFromChanges } from "@/lib/notifications/server";
import { loadTournament, type LoadedTournament } from "./load";
import type { StaffActor } from "./staff";

export type ActionSource = "table" | "captain" | "system" | "online";

export type ExecuteResult =
  | { ok: true; version: number; actionId: number; changes: Change[]; duplicate: boolean }
  | { ok: false; error: { code: string; details?: Record<string, string | number> }; status: number };

const MAX_ATTEMPTS = 4;

/** Offline actions keep their own time, within reason. */
export function actionTime(at: string | undefined): string {
  const now = Date.now();
  if (!at) return new Date(now).toISOString();
  const t = Date.parse(at);
  if (Number.isNaN(t) || t > now + 5 * 60_000 || t < now - 24 * 3600_000) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

function actorFields(actor: StaffActor | null, source: ActionSource) {
  return {
    actor_user_id: actor?.kind === "account" ? actor.userId : null,
    actor_staff_id: actor?.staffId ?? null,
    actor_label: actor?.label ?? (source === "captain" ? "Capitaine" : source === "online" ? "Inscription en ligne" : "Automatique"),
    source,
  };
}

/** Tells the live pages (public view, other scoring devices) that something changed. */
export async function broadcastUpdate(code: string, version: number): Promise<void> {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return;
  try {
    await fetch(`${env.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: `tournament:${code}`, event: "update", payload: { version }, private: true }] }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Live updates are a bonus: pages also refresh on their own.
  }
}

type Status = EngineState["tournament"]["status"];

/**
 * `tournaments.finished_at`: set when the engine moves the tournament to
 * "finished", cleared when a correction (or an undo) brings it back to play.
 * Closing (finished -> archived) keeps it: retention counts from the final.
 */
export function stampFinishedAt(dbChanges: DbChange[], before: Status, after: Status, at: string): DbChange[] {
  let finishedAt: string | null | undefined;
  if (after === "finished" && before !== "finished") finishedAt = at;
  else if (before === "finished" && after !== "finished" && after !== "archived") finishedAt = null;
  if (finishedAt === undefined) return dbChanges;
  return dbChanges.map((c) => (c.table === "tournaments" && c.op === "update" ? { ...c, values: { ...c.values, finished_at: finishedAt } } : c));
}

/**
 * A closed tournament (archived) accepts nothing more, not even an undo. Same for a purged
 * one (purged_at set): new data would never be purged (the purge never runs twice).
 */
const isClosed = (loaded: LoadedTournament) => loaded.state.tournament.status === "archived" || !!loaded.meta.purged_at;
const ARCHIVED: ExecuteResult = { ok: false, error: { code: "TOURNAMENT_ARCHIVED" }, status: 422 };

async function persist(
  loaded: LoadedTournament,
  after: EngineState,
  changes: Change[],
  action: Record<string, unknown>,
  at: string,
): Promise<{ ok: true; version: number; actionId: number; duplicate: boolean } | { ok: false; conflict: boolean; message: string }> {
  const admin = createAdminClient();
  const dbChanges = stampFinishedAt(toDbChanges(changes, after, loaded.meta.id), loaded.state.tournament.status, after.tournament.status, at);
  const { data, error } = await admin.rpc("apply_tournament_changes", {
    p_tournament: loaded.meta.id,
    p_expected_version: loaded.version,
    p_changes: dbChanges as never,
    p_action: { ...action, changes } as never,
  });
  if (error) return { ok: false, conflict: error.message.includes("version_conflict"), message: error.message };
  const res = data as { version: number; action_id: number; duplicate: boolean };
  return { ok: true, version: res.version, actionId: res.action_id, duplicate: res.duplicate };
}

/** "À vous de jouer" & co. are sent after the response: never slow down or break an action. */
function scheduleNotifications(code: string, changes: Change[], state: EngineState): void {
  const job = () => notifyFromChanges(code, changes, state);
  try {
    after(job);
  } catch {
    // Outside a request (scripts, tests): run it in the background.
    void job();
  }
}

/**
 * Runs an organizer command: load the latest state, compute with the engine,
 * save atomically. If someone else saved in between, start again from the
 * new state (the command expresses an intent, not a diff).
 */
export async function executeCommand(args: {
  code: string;
  command: Command;
  clientOpId: string;
  at?: string;
  actor: StaffActor | null;
  source?: ActionSource;
}): Promise<ExecuteResult> {
  const source = args.source ?? "table";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const loaded = await loadTournament(args.code, { secrets: true });
    if (!loaded) return { ok: false, error: { code: "NOT_FOUND" }, status: 404 };
    const now = actionTime(args.at);
    if (isClosed(loaded)) {
      // A retried operation that was applied before the close is still a success.
      const dup = await findAction(loaded.meta.id, args.clientOpId);
      if (dup) return { ok: true, version: dup.state_version ?? loaded.version, actionId: dup.id, changes: [], duplicate: true };
      return ARCHIVED;
    }
    let result;
    try {
      result = applyCommand(loaded.state, args.command, {
        now,
        newId: createIdGenerator(args.clientOpId),
        seed: args.clientOpId,
      });
    } catch (e) {
      if (e instanceof EngineError) {
        // A retried operation that was already applied is not an error.
        const dup = await findAction(loaded.meta.id, args.clientOpId);
        if (dup) return { ok: true, version: dup.state_version ?? loaded.version, actionId: dup.id, changes: [], duplicate: true };
        return { ok: false, error: { code: e.code, details: e.details }, status: 422 };
      }
      throw e;
    }
    if (result.changes.length === 0) {
      return { ok: true, version: loaded.version, actionId: 0, changes: [], duplicate: false };
    }
    const saved = await persist(loaded, result.state, result.changes, {
      type: args.command.type,
      payload: args.command,
      client_op_id: args.clientOpId,
      ...actorFields(args.actor, source),
    }, now);
    if (saved.ok) {
      if (!saved.duplicate) {
        await broadcastUpdate(args.code, saved.version);
        scheduleNotifications(args.code, result.changes, result.state);
      }
      return { ok: true, version: saved.version, actionId: saved.actionId, changes: saved.duplicate ? [] : result.changes, duplicate: saved.duplicate };
    }
    if (!saved.conflict) throw new Error(saved.message);
  }
  return { ok: false, error: { code: "BUSY" }, status: 409 };
}

async function findAction(tournamentId: string, clientOpId: string) {
  const { data } = await createAdminClient()
    .from("tournament_actions")
    .select("id, state_version")
    .eq("tournament_id", tournamentId)
    .eq("client_op_id", clientOpId)
    .maybeSingle();
  return data;
}

/**
 * Undoes an action. Refused when a later action touched the same things:
 * those must be undone first (the answer lists them).
 */
export async function undoAction(args: { code: string; actionId: number; clientOpId: string; actor: StaffActor }): Promise<ExecuteResult> {
  const admin = createAdminClient();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const loaded = await loadTournament(args.code, { secrets: true });
    if (!loaded) return { ok: false, error: { code: "NOT_FOUND" }, status: 404 };
    if (isClosed(loaded)) return ARCHIVED;
    const { data: target } = await admin
      .from("tournament_actions")
      .select("id, type, changes, undone_at, created_at")
      .eq("tournament_id", loaded.meta.id)
      .eq("id", args.actionId)
      .maybeSingle();
    if (!target) return { ok: false, error: { code: "NOT_FOUND" }, status: 404 };
    if (target.undone_at || target.type === "undo") return { ok: false, error: { code: "ALREADY_UNDONE" }, status: 422 };
    const changes = (target.changes ?? []) as Change[];
    const { data: later } = await admin
      .from("tournament_actions")
      .select("id, type, changes, undone_at")
      .eq("tournament_id", loaded.meta.id)
      .gt("id", target.id)
      .is("undone_at", null)
      .neq("type", "undo")
      .order("id");
    const laterList = later ?? [];
    const conflicts = conflictsWithLater(
      changes,
      laterList.map((a) => (a.changes ?? []) as Change[]),
    );
    if (conflicts.length || !canInvert(loaded.state, changes).ok) {
      const ids = conflicts.map((c) => laterList[c.index]!.id);
      return { ok: false, error: { code: "UNDO_CONFLICT", details: { actions: ids.join(",") } }, status: 409 };
    }
    const inverse = invertChanges(changes);
    const after = applyChanges(loaded.state, inverse);
    const saved = await persist(loaded, after, inverse, {
      type: "undo",
      payload: { actionId: target.id, undoneType: target.type },
      client_op_id: args.clientOpId,
      undoes: target.id,
      ...actorFields(args.actor, "table"),
    }, new Date().toISOString());
    if (saved.ok) {
      if (!saved.duplicate) await broadcastUpdate(args.code, saved.version);
      return { ok: true, version: saved.version, actionId: saved.actionId, changes: inverse, duplicate: saved.duplicate };
    }
    if (!saved.conflict) throw new Error(saved.message);
  }
  return { ok: false, error: { code: "BUSY" }, status: 409 };
}
