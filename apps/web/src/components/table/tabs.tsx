"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canDrawNext,
  isFinished,
  matchesOfRound,
  queuePosition,
  roundsOf,
  statusBeforeForfeit,
  teamsLeftOut,
  venueQueue,
  type Bracket,
  type EngineState,
  type ExtraBracket,
  type Match,
  type Team,
} from "@orgasport/engine";
import { getSport, venueLabel } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { formatEuros, formatTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { standings, type TeamView } from "@/terrain/view-model";
import type { ScoringTable } from "./store";
import { Btn, NumberInput, Panel, roundName, sideName, teamMap } from "./ui";
import { PinHelp } from "./PinHelp";
import { VolunteerSheetPrint } from "./VolunteerSheetPrint";
import { collectsEntries, entryCandidates, loneSideLabel, pauseHeld, pauseOf, tableBrackets } from "./bracket-model";
import { volunteerSheet, type VolunteerSheet } from "./volunteer-sheet";

const m = () => getMessages().table;

type TabProps = { table: ScoringTable; state: EngineState };

// ---------------------------------------------------------------------------
// Tournament stage
// ---------------------------------------------------------------------------

export function StatusControls({ table, state }: TabProps) {
  const t = m().status;
  const status = state.tournament.status;
  const next: { label: string; to: EngineState["tournament"]["status"] }[] = [];
  if (status === "published" || status === "registration_closed") next.push({ label: t.openCheckIn, to: "check_in" });
  if (status === "live") next.push({ label: t.finish, to: "finished" });
  if (status === "finished") next.push({ label: t.reopen, to: "live" });
  const pause = pauseOf(state);
  const held = pauseHeld(state);
  const p = m().pause;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink-soft">{t.title} :</span>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-black text-accent-ink">{(t as Record<string, string>)[status] ?? status}</span>
        {next.map((n) => (
          <Btn key={n.to} tone="ghost" onClick={() => table.dispatch({ type: "tournament.setStatus", status: n.to })}>
            {n.label}
          </Btn>
        ))}
      </div>
      {held && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-2 border-warning/60 bg-warning/10 p-3">
          <span className="grid">
            <strong className="text-lg">{p.title}</strong>
            <span className="text-sm">{pause ? fmt(p.text, { teams: pause.teams }) : p.reopened}</span>
          </span>
          {pause && (
            <Btn tone="primary" className="text-lg" onClick={() => table.dispatch({ type: "tournament.resume", seed: crypto.randomUUID?.() ?? String(Date.now()) })}>
              {p.resume}
            </Btn>
          )}
        </div>
      )}
      {status === "archived" && (
        <p role="status" className="rounded-[var(--radius)] bg-surface-2 p-3 font-bold">
          {m().closeLink.done}
        </p>
      )}
    </div>
  );
}

/**
 * Final close of the link (finished -> archived). Kept away from the daily
 * buttons (bottom of the page) and confirmed twice: open, tick, confirm.
 */
export function CloseLinkPanel({ table, state }: TabProps) {
  const t = m().closeLink;
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  if (state.tournament.status !== "finished") return null;
  return (
    <section aria-labelledby="close-link-title" className="mt-10 grid gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-danger/50 p-4">
      <h2 id="close-link-title" className="text-lg font-black">
        {t.title}
      </h2>
      <p className="text-sm text-ink-soft">{t.text}</p>
      {!open ? (
        <Btn tone="danger" className="justify-self-start" onClick={() => setOpen(true)}>
          {t.open}
        </Btn>
      ) : (
        <div className="grid gap-3">
          <label className="flex min-h-12 items-center gap-3 font-bold">
            <input type="checkbox" className="size-6 accent-danger" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {t.check}
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn
              tone="danger"
              disabled={!checked}
              onClick={() => {
                if (table.dispatch({ type: "tournament.close" })) {
                  setOpen(false);
                  setChecked(false);
                }
              }}
            >
              {t.confirm}
            </Btn>
            <Btn
              tone="ghost"
              onClick={() => {
                setOpen(false);
                setChecked(false);
              }}
            >
              {t.cancel}
            </Btn>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

function AddTeamForm({ table, size, onDone }: { table: ScoringTable; size: number; onDone: () => void }) {
  const t = m().checkin;
  const [players, setPlayers] = useState(() => Array.from({ length: Math.max(1, Math.min(size, 11)) }, () => ({ firstName: "", lastName: "" })));
  const [club, setClub] = useState("");
  const [name, setName] = useState("");
  const valid = players.some((p) => p.lastName.trim());
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const list = players.filter((p) => p.lastName.trim()).map((p) => ({ firstName: p.firstName.trim() || "-", lastName: p.lastName.trim() }));
        if (table.dispatch({ type: "team.create", players: list, club: club || null, name: name || null, checkIn: true, source: "onsite" })) onDone();
      }}
    >
      <h3 className="text-lg font-black">{t.addTitle}</h3>
      {players.map((p, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm font-bold">
            {fmt(t.player, { n: i + 1 })} · {t.firstName}
            <input
              className="h-12 rounded-[var(--radius)] border-2 border-line bg-bg px-3 text-base"
              value={p.firstName}
              autoFocus={i === 0}
              onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, firstName: e.target.value } : x)))}
            />
          </label>
          <label className="grid gap-1 text-sm font-bold">
            {t.lastName}
            <input
              className="h-12 rounded-[var(--radius)] border-2 border-line bg-bg px-3 text-base"
              value={p.lastName}
              onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, lastName: e.target.value } : x)))}
            />
          </label>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm font-bold">
          {t.club}
          <input className="h-12 rounded-[var(--radius)] border-2 border-line bg-bg px-3 text-base" value={club} onChange={(e) => setClub(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          {t.teamName}
          <input className="h-12 rounded-[var(--radius)] border-2 border-line bg-bg px-3 text-base" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn tone="primary" type="submit" disabled={!valid}>
          {t.addSubmit}
        </Btn>
        <Btn tone="ghost" onClick={onDone}>
          {m().draw.cancel}
        </Btn>
      </div>
    </form>
  );
}

export function CheckInTab({ table, state, teamSize }: TabProps & { teamSize: number }) {
  const t = m().checkin;
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const teams = useMemo(() => teamMap(state), [state]);
  const drawn = Object.values(state.rounds).some((r) => r.bracket === "main");
  const inDraw = useMemo(() => new Set(Object.values(state.matches).flatMap((x) => [...x.sideA, ...x.sideB])), [state]);
  const list = Object.values(state.teams)
    .filter((team) => {
      const v = teams.get(team.id);
      return !q || (v?.search ?? "").includes(q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
    })
    .sort((a, b) => a.number - b.number);
  const active = list.filter((x) => x.status !== "waitlist");
  const waitlist = list.filter((x) => x.status === "waitlist");
  const checked = Object.values(state.teams).filter((x) => x.status === "checked_in").length;
  const total = Object.values(state.teams).filter((x) => x.status !== "waitlist" && x.status !== "withdrawn").length;

  const row = (team: Team) => {
    const v = teams.get(team.id);
    const status = team.status;
    const late = drawn && status === "checked_in" && !inDraw.has(team.id);
    return (
      <li key={team.id} className={cn("flex flex-wrap items-center gap-3 rounded-[var(--radius)] border-2 p-3", status === "checked_in" ? "border-success/60 bg-success/5" : status === "forfeit" ? "border-danger/40 opacity-70" : "border-line")}>
        <span className="w-12 text-2xl font-black tabular">{team.number}</span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-lg font-bold">{v?.label}</span>
          <span className="truncate text-sm text-ink-soft">
            {team.club ?? ""} {state.teamSecrets[team.id] ? `· ${t.code} ${state.teamSecrets[team.id]!.code}` : ""}
          </span>
        </span>
        <span className="flex w-full flex-wrap justify-end gap-2 md:w-auto">
          {status === "forfeit" ? (
            <Btn tone="ghost" onClick={() => table.dispatch({ type: "team.setStatus", teamId: team.id, status: statusBeforeForfeit(team) })}>
              {t.cancelForfeit}
            </Btn>
          ) : (
            <>
              {late && (
                <Btn tone="primary" onClick={() => table.dispatch({ type: "team.lateEntry", teamId: team.id })}>
                  {t.late}
                </Btn>
              )}
              <Btn
                tone={status === "checked_in" ? "primary" : "default"}
                aria-pressed={status === "checked_in"}
                onClick={() => table.dispatch({ type: "team.setStatus", teamId: team.id, status: status === "checked_in" ? "registered" : "checked_in" })}
              >
                {status === "checked_in" ? `✓ ${t.present}` : t.present}
              </Btn>
              <Btn tone="danger" onClick={() => table.dispatch({ type: "team.setStatus", teamId: team.id, status: "forfeit" })}>
                {t.forfeit}
              </Btn>
            </>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="table-search"
          className="h-14 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-line bg-surface px-4 text-lg"
          placeholder={t.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-lg font-black tabular">{fmt(t.counter, { checked, total })}</span>
        <Btn tone="primary" onClick={() => setAdding(true)}>
          + {t.add}
        </Btn>
      </div>
      {adding && (
        <Panel>
          <AddTeamForm table={table} size={teamSize} onDone={() => setAdding(false)} />
        </Panel>
      )}
      {active.length === 0 && <p className="text-ink-soft">{t.noTeams}</p>}
      <ul className="grid gap-2">{active.map(row)}</ul>
      {waitlist.length > 0 && (
        <Panel title={t.waitlist}>
          <ul className="grid gap-2">
            {waitlist.map((team) => (
              <li key={team.id} className="flex items-center gap-3">
                <span className="w-12 text-xl font-black">{team.number}</span>
                <span className="flex-1 font-bold">{teams.get(team.id)?.label}</span>
                <Btn onClick={() => table.dispatch({ type: "team.setStatus", teamId: team.id, status: "checked_in" })}>{t.promote}</Btn>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/** « opt_in » B or C: tick the teams that enter (fee paid at the table), then draw. Replayed from the outbox offline. */
function EntriesPanel({ table, state, bracket }: TabProps & { bracket: ExtraBracket }) {
  const t = m().draw;
  const teams = useMemo(() => teamMap(state), [state]);
  const list = entryCandidates(state, bracket);
  const known = list.some((c) => c.eligible);
  const fee = (bracket === "consolation" ? state.tournament.config.consolation : state.tournament.config.consolationC).feeCents;
  const name = t.brackets[bracket]!;
  return (
    <Panel title={fmt(t.entriesTitle, { bracket: name })}>
      <p className="text-sm text-ink-soft">{t.entriesHint}</p>
      {fee ? <p className="text-sm font-bold">{fmt(t.entriesFee, { amount: formatEuros(fee) })}</p> : null}
      {!known && list.length > 0 && <p className="text-sm text-ink-soft">{t.entriesEarly}</p>}
      {list.length === 0 ? (
        <p className="text-ink-soft">{t.entriesNone}</p>
      ) : (
        <ul className="grid gap-1 md:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <label className={cn("flex min-h-12 items-center gap-3 rounded-[var(--radius)] border-2 px-3", c.entered ? "border-accent bg-accent-soft" : "border-line")}>
                <input
                  type="checkbox"
                  className="size-6 accent-accent"
                  checked={c.entered}
                  aria-label={`${fmt(t.entryLabel, { bracket: name })} : ${c.number} · ${teams.get(c.id)?.label ?? ""}`}
                  onChange={(e) => table.dispatch({ type: "team.enterBracket", teamId: c.id, bracket, enter: e.target.checked })}
                />
                <span className="w-10 text-xl font-black tabular">{c.number}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{teams.get(c.id)?.label}</span>
                {known && !c.eligible && <span className="text-xs font-bold text-ink-soft">{t.notLoser}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="font-bold tabular">
        {fmt(t.entriesCount, { count: list.filter((c) => c.entered).length })}
      </p>
    </Panel>
  );
}

export function DrawTab({ table, state }: TabProps) {
  const t = m().draw;
  const teams = useMemo(() => teamMap(state), [state]);
  const [swapFrom, setSwapFrom] = useState<{ matchId: string; side: "A" | "B"; label: string } | null>(null);
  const [confirmRedraw, setConfirmRedraw] = useState<string | null>(null);
  const venues = new Map(Object.values(state.venues).map((v) => [v.id, v.label]));
  const available = tableBrackets(state);
  const [shown, setShown] = useState<Bracket | "all">("all");
  const brackets = shown === "all" || !available.includes(shown) ? available : [shown];
  const paused = pauseHeld(state);
  const newSeed = () => crypto.randomUUID?.() ?? String(Date.now());
  const mainStarted = Object.values(state.rounds).some((r) => r.bracket === "main");
  const eligible = Object.values(state.teams).filter((x) => x.status === "checked_in").length || Object.values(state.teams).filter((x) => x.status === "registered").length;
  const leftOut = mainStarted ? [] : teamsLeftOut(state);

  const teamButton = (match: Match, side: "A" | "B") => {
    const ids = side === "A" ? match.sideA : match.sideB;
    const label = sideName(teams, ids);
    const swappable = ["waiting_venue", "ready", "bye"].includes(match.status);
    const selected = swapFrom?.matchId === match.id && swapFrom.side === side;
    return (
      <button
        type="button"
        disabled={!swappable || (!swapFrom && ids.length === 0)}
        onClick={() => {
          if (!swapFrom) setSwapFrom({ matchId: match.id, side, label });
          else {
            if (!selected) table.dispatch({ type: "match.swapTeams", a: { matchId: swapFrom.matchId, side: swapFrom.side }, b: { matchId: match.id, side } });
            setSwapFrom(null);
          }
        }}
        className={cn(
          "min-h-11 w-full rounded-[var(--radius-sm)] px-2 text-left font-bold disabled:cursor-default",
          selected ? "bg-accent text-on-accent" : swapFrom && swappable ? "bg-accent-soft hover:bg-accent/40" : "",
          match.winner === side && "underline decoration-2 underline-offset-4",
        )}
        title={swappable ? t.swap : undefined}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {canDrawNext(state, "main") && !paused && (
          <Btn tone="primary" className="text-lg" onClick={() => table.dispatch({ type: "round.draw", bracket: "main", seed: newSeed() })}>
            {mainStarted ? t.next : t.launch}
          </Btn>
        )}
        {(["consolation", "consolation_c"] as const).map(
          (b) =>
            canDrawNext(state, b) &&
            !paused && (
              <Btn key={b} onClick={() => table.dispatch({ type: "round.draw", bracket: b, seed: newSeed() })}>
                {b === "consolation" ? t.launchConsolation : t.launchConsolationC}
              </Btn>
            ),
        )}
        {!mainStarted && <p className="self-center font-bold text-ink-soft">{fmt(t.eligible, { count: eligible })}</p>}
      </div>
      {available.length > 1 && (
        <div role="group" aria-label={t.bracketFilter} className="flex flex-wrap items-center gap-1">
          <span className="mr-2 text-sm font-bold text-ink-soft">{t.bracketFilter} :</span>
          {(["all", ...available] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={shown === b}
              onClick={() => setShown(b)}
              className={cn(
                "min-h-12 min-w-12 rounded-[var(--radius)] border-2 px-3 font-black",
                shown === b ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink hover:bg-surface-2",
              )}
            >
              {b === "all" ? m().draw.allBrackets : t.brackets[b]}
            </button>
          ))}
        </div>
      )}
      {brackets.map((b) => (collectsEntries(state, b) ? <EntriesPanel key={`entries-${b}`} table={table} state={state} bracket={b} /> : null))}
      {leftOut.length > 0 && (
        <div role="status" className="rounded-[var(--radius)] border-2 border-warning/60 bg-warning/10 p-3">
          <p className="font-bold">{fmt(t.leftOut, { count: leftOut.length })}</p>
          <p className="text-ink-soft">{leftOut.map((x) => teams.get(x.id)?.label ?? `#${x.number}`).join(" · ")}</p>
          <p className="text-sm text-ink-soft">{t.leftOutHint}</p>
        </div>
      )}
      {mainStarted && state.tournament.config.autoNextRound && <p className="text-sm text-ink-soft">{t.auto}</p>}
      {swapFrom && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] bg-accent-soft p-3 font-bold">
          {fmt(t.swapHint, { team: swapFrom.label })}
          <Btn tone="ghost" onClick={() => setSwapFrom(null)}>
            {t.swapCancel}
          </Btn>
        </div>
      )}
      {!mainStarted && <p className="text-ink-soft">{t.none}</p>}
      {brackets.map((bracket) =>
        roundsOf(state, bracket)
          .filter((r) => r.status !== "pending")
          .reverse()
          .map((round) => {
            const ms = matchesOfRound(state, round.id);
            const canRedraw = ms.every((x) => !["done", "forfeit", "playing", "score_submitted", "disputed"].includes(x.status));
            return (
              <Panel
                key={round.id}
                title={roundName(state, round)}
                action={
                  canRedraw ? (
                    confirmRedraw === round.id ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{t.redrawConfirm}</span>
                        <Btn
                          tone="danger"
                          onClick={() => {
                            table.dispatch({ type: "round.redraw", roundId: round.id, seed: crypto.randomUUID?.() ?? String(Date.now()) });
                            setConfirmRedraw(null);
                          }}
                        >
                          {t.confirm}
                        </Btn>
                        <Btn tone="ghost" onClick={() => setConfirmRedraw(null)}>
                          {t.cancel}
                        </Btn>
                      </span>
                    ) : (
                      <Btn tone="ghost" onClick={() => setConfirmRedraw(round.id)}>
                        ↻ {t.redraw}
                      </Btn>
                    )
                  ) : undefined
                }
              >
                <ul className="grid gap-1">
                  {ms.map((x) => (
                    <li key={x.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem] items-center gap-2 border-b border-line py-1 last:border-0">
                      <span className="text-xl font-black tabular">{x.venueId && !isFinished(x) ? venues.get(x.venueId) : x.pool ?? ""}</span>
                      {teamButton(x, "A")}
                      {x.status === "bye" && !swapFrom ? (
                        <span className={cn("text-sm font-bold", loneSideLabel(state, x) === "office" ? "font-black text-ink" : "text-ink-soft")}>
                          {loneSideLabel(state, x) === "office" ? t.office : x.sideB.length ? getMessages().terrain.status.bye : t.exempt}
                        </span>
                      ) : (
                        teamButton(x, "B")
                      )}
                      <span className="text-right text-sm font-bold tabular text-ink-soft">
                        {x.status === "done" || x.status === "forfeit"
                          ? `${x.scoreA ?? ""}–${x.scoreB ?? ""}`
                          : loneSideLabel(state, x) === "office"
                            ? ""
                            : getMessages().terrain.status[x.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          }),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export function VenuesTab({ table, state, sportSlug }: TabProps & { sportSlug: string }) {
  const t = m().venues;
  const teams = useMemo(() => teamMap(state), [state]);
  const [label, setLabel] = useState("");
  const sport = getSport(sportSlug);
  const noun = sport ? venueLabel(sport) : "Terrain";
  const occupied = new Map<string, Match>();
  for (const x of Object.values(state.matches)) if (x.venueId && ["ready", "playing", "score_submitted", "disputed"].includes(x.status)) occupied.set(x.venueId, x);
  const queue = venueQueue(state);
  const venues = Object.values(state.venues).sort((a, b) => a.position - b.position);
  const remaining = Object.values(state.matches).filter((x) => !isFinished(x)).length;

  return (
    <div className="grid gap-4">
      {remaining > 0 && <p className="font-bold">{fmt(t.plan, { matches: remaining })}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {venues.map((v) => {
          const x = occupied.get(v.id);
          return (
            <li key={v.id} className={cn("grid gap-1 rounded-[var(--radius)] border-2 p-3", !v.available ? "border-line opacity-50" : x ? "border-ink" : "border-success")}>
              <span className="flex items-center justify-between">
                <span className="text-2xl font-black">
                  {noun} {v.label}
                </span>
                {v.reservedForFinals && <span className="rounded-full bg-accent-soft px-2 text-xs font-black text-accent-ink">{t.reserved}</span>}
              </span>
              <span className="min-h-10 text-sm font-bold">
                {!v.available ? t.closed : x ? `${sideName(teams, x.sideA)} / ${sideName(teams, x.sideB)}` : t.free}
              </span>
              <Btn tone="ghost" onClick={() => table.dispatch({ type: "venue.update", venueId: v.id, available: !v.available })}>
                {v.available ? t.close : t.open}
              </Btn>
            </li>
          );
        })}
      </ul>
      <Panel title={t.queue}>
        {queue.length === 0 ? (
          <p className="text-ink-soft">{t.queueEmpty}</p>
        ) : (
          <ol className="grid gap-2">
            {queue.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <span className="w-10 text-xl font-black">{queuePosition(state, x.id)}</span>
                <span className="flex-1 font-bold">
                  {sideName(teams, x.sideA)} / {sideName(teams, x.sideB)}
                </span>
                <select
                  className="h-12 rounded-[var(--radius)] border-2 border-line bg-bg px-2 font-bold"
                  value=""
                  aria-label={t.move}
                  onChange={(e) => e.target.value && table.dispatch({ type: "match.setVenue", matchId: x.id, venueId: e.target.value })}
                >
                  <option value="">{t.move}</option>
                  {venues
                    .filter((v) => v.available)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {noun} {v.label}
                        {occupied.has(v.id) ? " (occupé)" : ""}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && table.dispatch({ type: "venue.add", label: label.trim() })) setLabel("");
        }}
      >
        <label className="grid gap-1 text-sm font-bold">
          {t.addLabel}
          <input className="h-12 w-40 rounded-[var(--radius)] border-2 border-line bg-bg px-3" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <Btn type="submit">+ {t.add}</Btn>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

function ScoreRow({ table, state, match, teams, venueName }: TabProps & { match: Match; teams: Map<string, TeamView>; venueName: string }) {
  const t = m().scores;
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ta, setTa] = useState("");
  const [tb, setTb] = useState("");
  const round = state.rounds[match.roundId]!;
  const knockout = round.phase === "elimination" || round.phase === "final";
  const needsTiebreak = state.rules.scoring.mode === "time" && knockout && a !== "" && a === b;
  const finished = match.status === "done" || match.status === "forfeit";
  const submit = () => {
    if (a === "" || b === "") return;
    const ok = table.dispatch({
      type: "match.score",
      matchId: match.id,
      scoreA: Number(a),
      scoreB: Number(b),
      ...(needsTiebreak ? { tiebreakA: Number(ta), tiebreakB: Number(tb) } : {}),
    });
    if (ok) {
      setA("");
      setB("");
    }
  };
  return (
    <li className={cn("grid gap-2 rounded-[var(--radius)] border-2 p-3", match.status === "disputed" ? "border-danger" : match.status === "score_submitted" ? "border-warning" : "border-line")}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-2xl font-black">{venueName}</span>
        <span className="text-sm font-bold text-ink-soft">{roundName(state, round)}</span>
        {match.status === "score_submitted" && <span className="text-sm font-black text-warning">{t.submitted}</span>}
        {match.status === "disputed" && <span className="text-sm font-black text-danger">{t.disputed}</span>}
        {finished && <span className="text-sm font-black tabular">{`${match.scoreA ?? ""}–${match.scoreB ?? ""}`}</span>}
      </div>
      <form
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="grid gap-1 font-bold">
          <span>{sideName(teams, match.sideA)}</span>
          <span>{sideName(teams, match.sideB)}</span>
        </span>
        <span className="grid gap-1">
          <NumberInput aria-label={`Score ${sideName(teams, match.sideA)}`} value={a} onChange={(e) => setA(e.target.value)} />
          <NumberInput aria-label={`Score ${sideName(teams, match.sideB)}`} value={b} onChange={(e) => setB(e.target.value)} />
        </span>
        {needsTiebreak && (
          <span className="col-span-2 flex items-center gap-2 font-bold">
            {t.tiebreak} <NumberInput value={ta} onChange={(e) => setTa(e.target.value)} aria-label={`${t.tiebreak} A`} />
            <NumberInput value={tb} onChange={(e) => setTb(e.target.value)} aria-label={`${t.tiebreak} B`} />
          </span>
        )}
        <span className="col-span-2 flex flex-wrap gap-2">
          <Btn tone="primary" type="submit" disabled={a === "" || b === ""}>
            {finished ? t.correct : t.validate}
          </Btn>
          {match.status === "ready" && <Btn onClick={() => table.dispatch({ type: "match.start", matchId: match.id })}>{t.start}</Btn>}
          {finished ? (
            <Btn tone="ghost" onClick={() => table.dispatch({ type: "match.reopen", matchId: match.id })}>
              {t.reopen}
            </Btn>
          ) : (
            <>
              <Btn tone="danger" onClick={() => table.dispatch({ type: "match.forfeit", matchId: match.id, side: "A" })}>
                {fmt(t.forfeitA, { team: teams.get(match.sideA[0] ?? "")?.number ?? "A" })}
              </Btn>
              <Btn tone="danger" onClick={() => table.dispatch({ type: "match.forfeit", matchId: match.id, side: "B" })}>
                {fmt(t.forfeitA, { team: teams.get(match.sideB[0] ?? "")?.number ?? "B" })}
              </Btn>
            </>
          )}
        </span>
      </form>
    </li>
  );
}

export function ScoresTab({ table, state, sportSlug }: TabProps & { sportSlug: string }) {
  const t = m().scores;
  const teams = useMemo(() => teamMap(state), [state]);
  const [quick, setQuick] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const sport = getSport(sportSlug);
  const noun = sport ? venueLabel(sport) : "Terrain";
  const venues = new Map(Object.values(state.venues).map((v) => [v.id, v.label]));
  const active = Object.values(state.matches)
    .filter((x) => ["ready", "playing", "score_submitted", "disputed", "waiting_venue"].includes(x.status) && x.sideA.length && x.sideB.length)
    .sort((x, y) => (state.venues[x.venueId ?? ""]?.position ?? 999) - (state.venues[y.venueId ?? ""]?.position ?? 999));
  const recent = Object.values(state.matches)
    .filter((x) => x.status === "done" || x.status === "forfeit")
    .sort((x, y) => (y.endedAt ?? "").localeCompare(x.endedAt ?? ""))
    .slice(0, 12);

  useEffect(() => {
    quickRef.current?.focus();
  }, []);

  return (
    <div className="grid gap-4">
      <Panel title={t.quick}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parts = quick.trim().split(/[\s,;:/-]+/);
            if (parts.length < 3) return setHint(t.quickHint);
            const [venue, sa, sb] = parts as [string, string, string];
            const v = Object.values(state.venues).find((x) => x.label.toLowerCase() === venue.toLowerCase());
            const match = v && active.find((x) => x.venueId === v.id);
            if (!match) return setHint(t.noMatchOnVenue);
            if (table.dispatch({ type: "match.score", matchId: match.id, scoreA: Number(sa), scoreB: Number(sb) })) {
              setQuick("");
              setHint(`${noun} ${v.label} : ${sideName(teams, match.sideA)} ${sa}–${sb} ${sideName(teams, match.sideB)} ✓`);
            }
          }}
        >
          <input
            ref={quickRef}
            id="quick-score"
            className="h-14 min-w-0 flex-1 rounded-[var(--radius)] border-2 border-ink bg-bg px-4 text-2xl font-black tabular tracking-wider"
            placeholder={t.quickPlaceholder}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            autoComplete="off"
            inputMode="numeric"
          />
          <Btn tone="primary" type="submit" className="h-14">
            {t.validate}
          </Btn>
        </form>
        <p className="text-sm text-ink-soft" role="status">
          {hint ?? t.quickHint}
        </p>
      </Panel>
      <h2 className="text-xl font-black">{t.active}</h2>
      {active.length === 0 && <p className="text-ink-soft">{t.none}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {active.map((x) => (
          <ScoreRow key={x.id} table={table} state={state} match={x} teams={teams} venueName={x.venueId ? `${noun} ${venues.get(x.venueId)}` : "—"} />
        ))}
      </ul>
      {recent.length > 0 && (
        <>
          <h2 className="text-xl font-black">{t.recent}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {recent.map((x) => (
              <ScoreRow key={x.id} table={table} state={state} match={x} teams={teams} venueName={x.venueId ? `${noun} ${venues.get(x.venueId)}` : ""} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export function StandingsTab({ state }: { state: EngineState }) {
  const teams = useMemo(() => teamMap(state), [state]);
  const blocks = standings(state, getMessages());
  const tm = getMessages().terrain;
  return (
    <div className="grid gap-4">
      {blocks.map((b) => (
        <Panel key={b.title} title={b.title}>
          <table className="w-full text-left tabular">
            <thead>
              <tr className="text-sm text-ink-soft">
                <th className="py-1">{tm.rank}</th>
                <th>{tm.teams}</th>
                <th className="text-right">{tm.played}</th>
                <th className="text-right">{tm.wins}</th>
                <th className="text-right">{tm.diff}</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 text-lg font-black">{r.rank}</td>
                  <td className="font-bold">{teams.get(r.id) ? `${teams.get(r.id)!.number} · ${teams.get(r.id)!.label}` : ""}</td>
                  <td className="text-right">{r.stats.played}</td>
                  <td className="text-right">{r.stats.wins}</td>
                  <td className="text-right">{r.stats.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (undo)
// ---------------------------------------------------------------------------

type ActionRow = { id: number; type: string; actor_label: string | null; source: string; created_at: string; undone_at: string | null; payload: Record<string, unknown> };

function actionDetail(a: ActionRow): string {
  const p = a.payload as Record<string, unknown>;
  if (typeof p.scoreA === "number" && typeof p.scoreB === "number") return ` · ${p.scoreA}–${p.scoreB}`;
  if (typeof p.status === "string") return ` · ${p.status}`;
  if (typeof p.side === "string") return ` · ${p.side === "both" ? "double" : p.side}`;
  if (typeof p.label === "string") return ` · ${p.label}`;
  return "";
}

export function HistoryTab({ table, code, version }: { table: ScoringTable; code: string; version: number }) {
  const t = m().history;
  const [actions, setActions] = useState<ActionRow[] | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const load = async () => {
    const res = await fetch(`/api/t/${code}/history`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setActions(((await res.json()) as { actions: ActionRow[] }).actions);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch history when the state version moves
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the state version moves
  }, [version]);

  if (!actions) return <p className="text-ink-soft">{getMessages().table.loading}</p>;
  if (actions.length === 0) return <p className="text-ink-soft">{t.empty}</p>;
  return (
    <div className="grid gap-3">
      {conflict && <p className="rounded-[var(--radius)] bg-danger/10 p-3 font-bold text-danger">{conflict}</p>}
      <ul className="grid gap-2">
        {actions.map((a) => (
          <li key={a.id} className={cn("flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-line p-3", a.undone_at && "opacity-50")}>
            <span className="w-14 font-black tabular text-ink-soft">#{a.id}</span>
            <span className="grid min-w-0 flex-1">
              <span className="font-bold">
                {t.types[a.type] ?? a.type}
                {actionDetail(a)}
                {a.undone_at ? ` · ${t.undone}` : ""}
              </span>
              <span className="text-sm text-ink-soft">
                {formatTime(a.created_at)} · {fmt(t.by, { who: a.actor_label ?? "?" })}
              </span>
            </span>
            {!a.undone_at && a.type !== "undo" && (
              <Btn
                tone="ghost"
                onClick={async () => {
                  setConflict(null);
                  const res = await table.undo(a.id);
                  if (!res.ok && res.error?.code === "UNDO_CONFLICT") setConflict(fmt(t.conflict, { actions: `#${String(res.error.details?.actions ?? "").split(",").join(", #")}` }));
                  void load();
                }}
              >
                ↶ {t.undo}
              </Btn>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access (PINs)
// ---------------------------------------------------------------------------

type StaffRow = { id: string; role: string; label: string; user_id: string | null; revoked_at: string | null; hasPin: boolean };

export function AccessTab({ code, isAccount, tournamentName }: { code: string; isAccount: boolean; tournamentName: string }) {
  const t = m().access;
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  // The PIN stays in memory only (never in a URL or storage): enough to print the sheet now.
  const [sheet, setSheet] = useState<VolunteerSheet | null>(null);
  const [printing, setPrinting] = useState(false);
  const stopPrinting = useCallback(() => setPrinting(false), []);
  const load = async () => {
    const res = await fetch(`/api/t/${code}/staff`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setStaff(((await res.json()) as { staff: StaffRow[] }).staff);
    setLoaded(true);
  };
  const create = async (name: string) => {
    const res = await fetch(`/api/t/${code}/staff`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: name }) });
    if (!res.ok) return false;
    const body = (await res.json()) as { pin: string; staff: { label: string } };
    setCreated(fmt(t.created, { label: body.staff.label, pin: body.pin }));
    setSheet(volunteerSheet({ code, tournamentName, label: body.staff.label, pin: body.pin }));
    void load();
    return true;
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load staff list
    if (isAccount) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, [isAccount]);
  if (!isAccount) return <p className="text-ink-soft">{t.organizerOnly}</p>;
  const hasActivePin = staff.some((s) => s.hasPin && !s.revoked_at);
  return (
    <div className="grid gap-4">
      <Panel title={t.title}>
        <PinHelp audience="organizer" tableUrl={`/c/${code}/table`} />
        {loaded && !hasActivePin && !sheet && (
          <div className="grid gap-2 rounded-[var(--radius)] border-2 border-accent p-3">
            <h3 className="text-lg font-black">{t.tablePinTitle}</h3>
            <p className="text-ink-soft">{t.tablePinHint}</p>
            <Btn tone="primary" className="justify-self-start" onClick={() => void create(t.tablePinLabel)}>
              {t.tablePinCreate}
            </Btn>
          </div>
        )}
        {loaded && !hasActivePin && !sheet && <p className="font-bold">{t.other}</p>}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!label.trim()) return;
            if (await create(label)) setLabel("");
          }}
        >
          <label className="grid min-w-0 gap-1 text-sm font-bold">
            {t.label}
            <input className="h-12 w-64 max-w-full rounded-[var(--radius)] border-2 border-line bg-bg px-3" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <Btn tone={hasActivePin || sheet ? "primary" : "default"} type="submit">
            {t.create}
          </Btn>
        </form>
        {created && (
          <div className="grid gap-2 rounded-[var(--radius)] bg-success/10 p-3">
            <p className="text-lg font-black text-success">{created}</p>
            {sheet && (
              <>
                <Btn tone="primary" className="justify-self-start" onClick={() => setPrinting(true)}>
                  🖨 {t.print}
                </Btn>
                <p className="text-sm text-ink-soft">{t.printHint}</p>
              </>
            )}
          </div>
        )}
        {printing && sheet && <VolunteerSheetPrint sheet={sheet} onDone={stopPrinting} />}
      </Panel>
      <ul className="grid gap-2">
        {staff.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-line p-3">
            <span className="flex-1 font-bold">
              {s.label} <span className="text-sm text-ink-soft">· {s.hasPin ? "PIN" : "compte"}</span>
            </span>
            {s.revoked_at ? (
              <span className="text-sm font-bold text-ink-soft">{t.revoked}</span>
            ) : s.role !== "organizer" ? (
              <Btn
                tone="danger"
                onClick={async () => {
                  await fetch(`/api/t/${code}/staff/${s.id}`, { method: "DELETE" });
                  void load();
                }}
              >
                {t.revoke}
              </Btn>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
