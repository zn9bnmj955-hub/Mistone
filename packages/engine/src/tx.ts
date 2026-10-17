import type { EngineState, EntityName } from "./types";

/**
 * A command never mutates the state it receives. It works on a Transaction
 * that records every change; the changes are what gets saved, broadcast and,
 * inverted, what makes any action undoable.
 */

type Row = Record<string, unknown>;

export type Change =
  | { op: "create"; entity: EntityName; id: string; after: Row }
  | { op: "update"; entity: EntityName; id: string; before: Row; after: Row }
  | { op: "delete"; entity: EntityName; id: string; before: Row };

const COLLECTIONS = {
  team: "teams",
  player: "players",
  venue: "venues",
  round: "rounds",
  match: "matches",
  teamSecret: "teamSecrets",
  registration: "registrations",
} as const satisfies Partial<Record<EntityName, keyof EngineState>>;

type CollectionEntity = keyof typeof COLLECTIONS;
type EntityType<E extends CollectionEntity> = EngineState[(typeof COLLECTIONS)[E]][string];

function collectionOf(entity: EntityName): keyof EngineState | null {
  return entity === "tournament" ? null : COLLECTIONS[entity as CollectionEntity];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Transaction {
  state: EngineState;
  readonly changes: Change[] = [];
  private copied = new Set<string>();

  /** The state before this action (read only, never changed). */
  readonly base: EngineState;

  constructor(base: EngineState) {
    this.base = base;
    this.state = { ...base };
  }

  private writable(collection: keyof EngineState): Record<string, Row> {
    if (!this.copied.has(collection)) {
      (this.state as unknown as Record<string, unknown>)[collection] = {
        ...(this.state[collection] as unknown as Record<string, Row>),
      };
      this.copied.add(collection);
    }
    return this.state[collection] as unknown as Record<string, Row>;
  }

  get<E extends CollectionEntity>(entity: E, id: string): EntityType<E> | undefined {
    return (this.state[COLLECTIONS[entity]] as Record<string, EntityType<E>>)[id];
  }

  create<E extends CollectionEntity>(entity: E, value: EntityType<E>): EntityType<E> {
    const coll = this.writable(COLLECTIONS[entity]);
    const id = (value as { id: string }).id;
    if (coll[id]) throw new Error(`${entity} ${id} already exists`);
    coll[id] = value as unknown as Row;
    this.changes.push({ op: "create", entity, id, after: { ...(value as unknown as Row) } });
    return value;
  }

  update<E extends CollectionEntity>(entity: E, id: string, patch: Partial<EntityType<E>>): EntityType<E> {
    const coll = this.writable(COLLECTIONS[entity]);
    const current = coll[id];
    if (!current) throw new Error(`${entity} ${id} not found`);
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch as Row)) {
      if (!sameValue(current[k], v)) {
        before[k] = current[k];
        after[k] = v;
      }
    }
    if (Object.keys(after).length === 0) return current as unknown as EntityType<E>;
    const next = { ...current, ...after };
    coll[id] = next;
    this.changes.push({ op: "update", entity, id, before, after });
    return next as unknown as EntityType<E>;
  }

  remove<E extends CollectionEntity>(entity: E, id: string): void {
    const coll = this.writable(COLLECTIONS[entity]);
    const current = coll[id];
    if (!current) return;
    delete coll[id];
    this.changes.push({ op: "delete", entity, id, before: { ...current } });
  }

  updateTournament(patch: Partial<EngineState["tournament"]>): void {
    const current = this.state.tournament as unknown as Row;
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch as Row)) {
      if (!sameValue(current[k], v)) {
        before[k] = current[k];
        after[k] = v;
      }
    }
    if (Object.keys(after).length === 0) return;
    this.state.tournament = { ...this.state.tournament, ...(after as Partial<EngineState["tournament"]>) };
    this.changes.push({ op: "update", entity: "tournament", id: this.state.tournament.id, before, after });
  }

  /** Changes merged per entity (create+update → create, update+delete → delete…). */
  compacted(): Change[] {
    return compactChanges(this.changes);
  }
}

export function compactChanges(changes: Change[]): Change[] {
  const byKey = new Map<string, Change | null>();
  const order: string[] = [];
  for (const c of changes) {
    const key = `${c.entity}:${c.id}`;
    if (!byKey.has(key)) order.push(key);
    const prev = byKey.get(key);
    if (prev === undefined || prev === null) {
      byKey.set(key, c);
      continue;
    }
    if (prev.op === "create" && c.op === "update") byKey.set(key, { ...prev, after: { ...prev.after, ...c.after } });
    else if (prev.op === "create" && c.op === "delete") byKey.set(key, null);
    else if (prev.op === "update" && c.op === "update")
      byKey.set(key, { ...prev, before: { ...c.before, ...prev.before }, after: { ...prev.after, ...c.after } });
    else if (prev.op === "update" && c.op === "delete") byKey.set(key, { op: "delete", entity: c.entity, id: c.id, before: { ...c.before, ...prev.before } });
    else if (prev.op === "delete" && c.op === "create") byKey.set(key, { op: "update", entity: c.entity, id: c.id, before: prev.before, after: c.after });
    else byKey.set(key, c);
  }
  const out: Change[] = [];
  for (const key of order) {
    const c = byKey.get(key);
    if (!c) continue;
    if (c.op === "update") {
      // Drop fields that ended up unchanged.
      const before: Row = {};
      const after: Row = {};
      for (const k of Object.keys(c.after)) {
        if (!sameValue(c.before[k], c.after[k])) {
          before[k] = c.before[k];
          after[k] = c.after[k];
        }
      }
      if (Object.keys(after).length) out.push({ ...c, before, after });
    } else out.push(c);
  }
  return out;
}

/** The changes that cancel `changes`. */
export function invertChanges(changes: Change[]): Change[] {
  return [...changes].reverse().map((c): Change => {
    if (c.op === "create") return { op: "delete", entity: c.entity, id: c.id, before: c.after };
    if (c.op === "delete") return { op: "create", entity: c.entity, id: c.id, after: c.before };
    return { op: "update", entity: c.entity, id: c.id, before: c.after, after: c.before };
  });
}

/** Applies recorded changes to a state (used to replay server results on the client and for undo). */
export function applyChanges(state: EngineState, changes: Change[]): EngineState {
  const tx = new Transaction(state);
  for (const c of changes) {
    if (c.entity === "tournament") {
      if (c.op === "update") tx.updateTournament(c.after as Partial<EngineState["tournament"]>);
      continue;
    }
    const entity = c.entity as CollectionEntity;
    if (c.op === "create") tx.create(entity, c.after as never);
    else if (c.op === "update") tx.update(entity, c.id, c.after as never);
    else tx.remove(entity, c.id);
  }
  return tx.state;
}

/**
 * True when the entities touched by `changes` still hold the values those
 * changes produced, i.e. nothing changed them since and the inverse can be
 * applied safely.
 */
export function canInvert(state: EngineState, changes: Change[]): { ok: true } | { ok: false; conflicts: string[] } {
  const conflicts: string[] = [];
  for (const c of compactChanges(changes)) {
    const coll = collectionOf(c.entity);
    const current = (coll ? (state[coll] as unknown as Record<string, Row>)[c.id] : (state.tournament as unknown as Row)) as Row | undefined;
    if (c.op === "delete") {
      if (current) conflicts.push(`${c.entity}:${c.id}`);
      continue;
    }
    if (!current) {
      conflicts.push(`${c.entity}:${c.id}`);
      continue;
    }
    for (const [k, v] of Object.entries(c.after)) {
      if (!sameValue(current[k], v)) {
        conflicts.push(`${c.entity}:${c.id}`);
        break;
      }
    }
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true };
}

/**
 * Entities touched both by an action and by actions recorded after it. An
 * action can only be undone when this list is empty; otherwise the later
 * actions must be undone first.
 */
export function conflictsWithLater(changes: Change[], later: Change[][]): { index: number; keys: string[] }[] {
  const mine = new Set(changes.map((c) => `${c.entity}:${c.id}`));
  const out: { index: number; keys: string[] }[] = [];
  later.forEach((list, index) => {
    const keys = [...new Set(list.map((c) => `${c.entity}:${c.id}`))].filter((k) => mine.has(k));
    if (keys.length) out.push({ index, keys });
  });
  return out;
}
