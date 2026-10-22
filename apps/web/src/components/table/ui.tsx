"use client";
import type { ComponentProps, ReactNode } from "react";
import { buildTeamViews, roundLabel, type TeamView } from "@/terrain/view-model";
import { getMessages } from "@/i18n";
import { roundLabel as engineRoundLabel, type EngineState, type Round } from "@orgasport/engine";
import { cn } from "@/components/ui/cn";

/** Small building blocks of the scoring table: big, keyboard friendly. */

export function Btn({ tone = "default", className, ...props }: ComponentProps<"button"> & { tone?: "default" | "primary" | "danger" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius)] px-4 text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary" && "bg-accent text-on-accent hover:brightness-105",
        tone === "danger" && "border-2 border-danger text-danger hover:bg-danger-soft",
        tone === "ghost" && "text-ink-soft hover:bg-surface-2 hover:text-ink",
        tone === "default" && "border-2 border-ink bg-surface text-ink hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-xl font-black">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function NumberInput(props: ComponentProps<"input">) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      className="h-12 w-20 rounded-[var(--radius)] border-2 border-line bg-bg text-center text-xl font-black tabular text-ink focus:border-accent"
      {...props}
    />
  );
}

export function teamMap(state: EngineState): Map<string, TeamView> {
  // Staff always see full last names, whatever the public display rule.
  return buildTeamViews(state, "full");
}

export function sideName(teams: Map<string, TeamView>, side: string[]): string {
  if (side.length === 0) return "—";
  return side
    .map((id) => {
      const t = teams.get(id);
      return t ? `${t.number} · ${t.label}` : "?";
    })
    .join(" & ");
}

/** « Cadrage », « Quarts de finale »…, prefixed « Concours B · » / « Concours C · » outside the A. */
export function roundName(state: EngineState, round: Round): string {
  const m = getMessages();
  const label =
    engineRoundLabel(state, round).key === "cadrage" ? m.table.draw.cadrage : roundLabel(state, { ...round, bracket: "main" }, m);
  return round.bracket === "main" ? label : `${m.table.draw.bracketNames[round.bracket]} · ${label}`;
}
