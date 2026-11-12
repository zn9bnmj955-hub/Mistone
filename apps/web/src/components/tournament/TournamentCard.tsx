import Link from "next/link";
import { Icon } from "@orgasport/ui";
import { getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { formatEuros } from "@/lib/format";
import type { TournamentCard as HomeCard } from "@/lib/data/tournaments";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import {
  cardAction,
  detailsHref,
  eligibilityLabel,
  placesInfo,
  statusBadge,
  toCardModel,
  whenLabel,
  type CatalogCardRow,
} from "@/components/catalog/model";

/**
 * Tournament card of the home feed and the catalog. The whole card opens the
 * details page (stretched link); the « S'inscrire » / « Suivre en direct »
 * shortcut sits above it. `nowMs` (catalog rows only) enables the
 * registration state, which needs the current time.
 */
export function TournamentCard({ t, nowMs }: { t: HomeCard | CatalogCardRow; nowMs?: number }) {
  const m = getMessages();
  const c = toCardModel(t, nowMs);
  const sport = getSport(c.sportSlug);
  const teamFormat = sport?.teamFormats.find((f) => f.id === c.teamFormat)?.label;
  const places = placesInfo(c);
  const badge = statusBadge(c);
  const action = cardAction(c);
  return (
    <article
      data-sport={sport?.accentToken}
      className="group relative grid gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink-soft">
          <Icon name={sport?.icon ?? "all"} size={18} />
          <span>{sport?.name}</span>
          {teamFormat && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{teamFormat}</span>
            </>
          )}
        </p>
        <Badge tone={badge.tone} className="shrink-0">
          {badge.label}
        </Badge>
      </div>
      <div className="grid gap-1">
        <h3 className="display text-2xl group-hover:text-accent-ink">
          <Link
            href={detailsHref(c.code)}
            className="after:absolute after:inset-0 after:rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:after:[outline:3px_solid_var(--os-focus)]"
          >
            {c.name}
          </Link>
        </h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <Icon name="calendar" size={16} />
            <span className="tabular">{whenLabel(c.startsAt)}</span>
          </span>
          {c.city && (
            <span className="inline-flex items-center gap-1">
              <Icon name="mapPin" size={16} />
              {c.city}
              {c.distanceKm != null && (
                <span className="tabular"> · {fmt(m.catalogPage.card.distance, { km: Math.max(1, Math.round(c.distanceKm)) })}</span>
              )}
            </span>
          )}
        </p>
        {c.competitionFormat && <p className="text-sm font-semibold text-ink-soft">{m.formatLabels[c.competitionFormat]}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">
          {c.feeCents > 0
            ? fmt(m.tournament.fee, { amount: formatEuros(c.feeCents), per: c.feePer === "player" ? m.tournament.perPlayer : m.tournament.perTeam })
            : m.tournament.free}
        </span>
        {c.prizeText && (
          <span className="inline-flex items-center gap-1 text-ink-soft">
            <Icon name="trophy" size={16} className="shrink-0" />
            {c.prizeText}
          </span>
        )}
        <Badge tone={c.eligibility === "licensed" ? "warning" : "neutral"} className="ml-auto">
          {eligibilityLabel(c.eligibility)}
        </Badge>
      </div>
      <div className="grid gap-1">
        {places.fill !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className={cn("h-full rounded-full", places.full ? "bg-ink-soft" : "bg-accent")} style={{ width: `${Math.round(places.fill * 100)}%` }} />
          </div>
        )}
        <p className="text-xs font-bold text-ink-soft tabular">{places.text}</p>
      </div>
      {(c.clubName || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {c.clubName && <p className="min-w-0 text-sm font-semibold text-ink-soft">{fmt(m.tournament.by, { club: c.clubName })}</p>}
          {action && (
            // Plain link: /c/… pages are light HTML route handlers, not React pages.
            <a href={action.href} className={buttonClass(action.kind === "register" ? "primary" : "outline", "md", "relative z-10 ml-auto")}>
              {action.kind === "live" && <Icon name="live" size={20} />}
              {action.label}
              {action.kind === "register" && <Icon name="arrowRight" size={20} />}
            </a>
          )}
        </div>
      )}
    </article>
  );
}
