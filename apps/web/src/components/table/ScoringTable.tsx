"use client";
import { useEffect, useState } from "react";
import { LogoMark } from "@orgasport/ui";
import { getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { cn } from "@/components/ui/cn";
import { PrintTab } from "./PrintTab";
import { useScoringTable } from "./store";
import { AccessTab, CheckInTab, CloseLinkPanel, DrawTab, HistoryTab, ScoresTab, StandingsTab, StatusControls, VenuesTab } from "./tabs";
import { Btn } from "./ui";

type Tab = "checkin" | "draw" | "venues" | "scores" | "standings" | "history" | "print" | "access";
const TABS: Tab[] = ["checkin", "draw", "venues", "scores", "standings", "history", "print", "access"];

function errorText(code: string, details?: Record<string, string | number>): string {
  const t = getMessages().table.errors;
  const base = t[code] ?? getMessages().common.error;
  return details?.round ? `${base} (tour ${details.round})` : base;
}

/** The scoring table: big buttons, keyboard shortcuts, works offline. */
export function ScoringTable({ code }: { code: string }) {
  const m = getMessages();
  const t = m.table;
  const table = useScoringTable(code);
  const { snap, view } = table;
  const [tab, setTab] = useState<Tab>("checkin");

  // Start on the useful tab: scores once the tournament is live.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick the first tab once data is there
    if (snap && Object.keys(snap.state.rounds).length > 0) setTab((current) => (current === "checkin" ? "scores" : current));
  }, [snap?.tournament.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: 1-8 switch tabs, "/" jumps to the search or quick score field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "Escape" && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        target.blur();
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) {
        setTab(TABS[n - 1]!);
        e.preventDefault();
      } else if (e.key === "/") {
        (document.getElementById("quick-score") ?? document.getElementById("table-search"))?.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (table.unauthorized) {
    return (
      <div className="mx-auto grid max-w-md gap-4 p-6">
        <p role="alert" className="text-lg font-bold">
          {t.errors.UNAUTHORIZED}
        </p>
        <Btn tone="primary" onClick={() => window.location.reload()}>
          {t.pinSubmit}
        </Btn>
      </div>
    );
  }
  if (!snap || !view) return <p className="p-6 text-lg font-bold text-ink-soft">{t.loading}</p>;

  const sport = getSport(snap.tournament.sportSlug);
  const teamSize = sport?.teamFormats.find((f) => f.id === snap.tournament.teamFormat)?.players ?? 2;
  const pending = table.outbox.length;
  const connection = !table.online ? "offline" : pending > 0 || table.syncing ? "syncing" : "online";

  return (
    <div data-sport={sport?.accentToken} className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <LogoMark size={28} />
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-xl font-black">{snap.tournament.name}</span>
            <span className="text-sm font-bold text-ink-soft">
              {t.title} · {snap.tournament.code} · {snap.actor.label}
            </span>
          </div>
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-black",
              connection === "online" && "bg-success-soft text-success",
              connection === "syncing" && "bg-warning-soft text-warning",
              connection === "offline" && "bg-danger text-on-status",
            )}
          >
            <span className="size-2.5 rounded-full bg-current" aria-hidden="true" />
            {connection === "offline" ? t.offline : connection === "syncing" ? t.syncing : t.online}
            {pending > 0 && ` · ${fmt(t.pending, { count: pending })}`}
          </span>
          <a className="text-sm font-bold underline" href={`/c/${code}`} target="_blank" rel="noreferrer">
            {t.publicPage}
          </a>
          {snap.actor.kind === "pin" && (
            <Btn
              tone="ghost"
              onClick={async () => {
                await fetch(`/api/t/${code}/pin`, { method: "DELETE" });
                window.location.reload();
              }}
            >
              {t.signOutPin}
            </Btn>
          )}
        </div>
        <nav aria-label={t.title} className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2">
          {TABS.map((id, i) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
              className={cn(
                "min-h-12 shrink-0 border-b-4 px-3 text-base font-black",
                tab === id ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              <span className="mr-1 text-xs text-ink-soft">{i + 1}</span>
              {t.tabs[id]}
            </button>
          ))}
        </nav>
      </header>

      <main id="contenu" className="mx-auto grid max-w-6xl gap-4 px-4 py-4">
        {pending > 0 && <p className="text-sm font-bold text-warning">{t.pendingHint}</p>}
        {table.notice && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] bg-danger-soft p-3 font-bold text-danger">
            {errorText(table.notice.code, table.notice.details)}
            <Btn tone="ghost" onClick={table.clearNotice}>
              {m.common.close}
            </Btn>
          </div>
        )}
        {table.failed.length > 0 && (
          <div className="grid gap-2 rounded-[var(--radius)] border-2 border-danger p-3">
            <strong>{t.toCheck}</strong>
            <p className="text-sm">{t.toCheckHint}</p>
            <ul className="text-sm">
              {table.failed.map((f) => (
                <li key={f.op.clientOpId}>
                  {t.history.types[f.op.command.type] ?? f.op.command.type} — {errorText(f.code, f.details)}
                </li>
              ))}
            </ul>
            <Btn tone="ghost" onClick={table.dismissFailed}>
              {t.dismiss}
            </Btn>
          </div>
        )}
        <StatusControls table={table} state={view} />
        {tab === "checkin" && <CheckInTab table={table} state={view} teamSize={teamSize} />}
        {tab === "draw" && <DrawTab table={table} state={view} />}
        {tab === "venues" && <VenuesTab table={table} state={view} sportSlug={snap.tournament.sportSlug} />}
        {tab === "scores" && <ScoresTab table={table} state={view} sportSlug={snap.tournament.sportSlug} />}
        {tab === "standings" && <StandingsTab state={view} />}
        {tab === "history" && <HistoryTab table={table} code={code} version={snap.version} />}
        {tab === "print" && <PrintTab state={view} tournament={snap.tournament} />}
        {tab === "access" && <AccessTab code={code} isAccount={Boolean(snap.actor.canManageAccess)} tournamentName={snap.tournament.name} />}
        <p className="text-xs text-ink-soft">{t.shortcuts} Échap : quitter un champ.</p>
        <CloseLinkPanel table={table} state={view} />
      </main>
    </div>
  );
}
