import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@orgasport/ui";
import { getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import type { FeedItem } from "@/lib/data/feed";
import { formatDay } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { ClubLogo } from "@/components/club/ClubLogo";
import { TournamentCard } from "@/components/tournament/TournamentCard";

/**
 * The ranked home feed: one list, each card announced by a short label
 * (« Inscriptions bientôt closes », « Résultat », « Actualité »…). Server
 * rendered, no client JavaScript.
 */

const CARD_BASE = "relative grid gap-1.5 rounded-[var(--radius-lg)] border border-line bg-surface p-4";
/** Whole card is one link: lifts with the accent glow on hover and keyboard focus. */
const CARD = `${CARD_BASE} card-lift`;
/** Card with its own links inside (club announcement): resting depth only. */
const CARD_STATIC = `${CARD_BASE} card-depth`;
const CARD_ROW = "relative flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-lift";
const STRETCHED =
  "after:absolute after:inset-0 after:rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:after:[outline:3px_solid_var(--os-focus)]";

function Kicker({ icon, label, followed, live }: { icon: IconName; label: string; followed?: boolean; live?: boolean }) {
  const t = getMessages().feed.kicker;
  return (
    <p className="flex items-center gap-2 px-1 text-xs font-bold tracking-wide text-ink-soft uppercase">
      {live ? <Badge tone="live">{t.live}</Badge> : <Icon name={icon} size={16} />}
      {!live && <span>{label}</span>}
      {followed && <Badge tone="accent">{t.followed}</Badge>}
    </p>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold text-ink-soft">{children}</p>;
}

function Entry({ item, nowMs }: { item: FeedItem; nowMs: number }) {
  const m = getMessages();
  const t = m.feed;
  const sport = item.sport ? getSport(item.sport) : undefined;
  const dot = <span aria-hidden="true"> · </span>;

  switch (item.kind) {
    case "upcoming":
    case "closing":
      return (
        <>
          <Kicker
            icon={item.kind === "closing" ? "clock" : "calendar"}
            label={item.kind === "closing" ? t.kicker.closing : t.kicker.upcoming}
            followed={item.followed}
            live={item.live}
          />
          <TournamentCard t={item.tournament} nowMs={nowMs} />
        </>
      );
    case "result": {
      const r = item.result;
      return (
        <>
          <Kicker icon="trophy" label={t.kicker.result} followed={item.followed} />
          <article data-sport={sport?.accentToken} className={`group ${CARD}`}>
            <Meta>
              {[r.clubName, r.city, formatDay(r.startsAt)].filter(Boolean).join(" · ")}
            </Meta>
            <h3 className="display text-2xl group-hover:text-accent-ink">
              <Link href={`/c/${r.code}?vue=classement`} className={STRETCHED}>
                {r.name}
              </Link>
            </h3>
            <p className="flex flex-wrap items-center gap-x-3 text-sm">
              {r.teamCount > 0 && <span className="text-ink-soft tabular">{fmt(t.result.teams, { count: r.teamCount })}</span>}
              <span className="inline-flex items-center gap-1 font-bold text-accent-ink">
                {t.result.finished}
                <Icon name="arrowRight" size={16} />
              </span>
            </p>
          </article>
        </>
      );
    }
    case "announcement": {
      const a = item.announcement;
      return (
        <>
          <Kicker icon="bell" label={t.kicker.announcement} followed={item.followed} />
          <article data-sport={sport?.accentToken} className={CARD_STATIC}>
            <Meta>
              {a.clubSlug ? (
                <Link href={`/clubs/${a.clubSlug}`} className="hover:text-ink">
                  {a.clubName}
                </Link>
              ) : (
                a.clubName
              )}
              {a.publishedAt && (
                <>
                  {dot}
                  {formatDay(a.publishedAt)}
                </>
              )}
            </Meta>
            <h3 className="text-lg font-bold">{a.title}</h3>
            {a.body && <p className="line-clamp-3 text-ink-soft">{a.body}</p>}
            {a.linkUrl && (
              <a href={a.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-10 items-center gap-1 justify-self-start font-bold text-accent-ink">
                {t.announcement.open}
                <Icon name="arrowRight" size={16} />
                <span className="sr-only">{t.news.opensSource}</span>
              </a>
            )}
          </article>
        </>
      );
    }
    case "newClub": {
      const c = item.club;
      return (
        <>
          <Kicker icon="club" label={t.kicker.newClub} followed={item.followed} />
          <article data-sport={sport?.accentToken} className={`group ${CARD_ROW}`}>
            <ClubLogo url={c.logoUrl} name={c.name} alt="" />
            <div className="grid min-w-0 gap-0.5">
              <h3 className="display truncate text-2xl group-hover:text-accent-ink">
                <Link href={`/clubs/${c.slug}`} className={STRETCHED}>
                  {c.name}
                </Link>
              </h3>
              <p className="flex items-center gap-1 text-sm text-ink-soft">
                {sport && <Icon name={sport.icon} size={16} />}
                {[sport?.name, c.city, item.distanceKm != null ? fmt(t.kicker.upcomingNear, { km: Math.max(1, Math.round(item.distanceKm)) }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </article>
        </>
      );
    }
    case "news": {
      const n = item.news;
      return (
        <>
          <Kicker icon="sparkle" label={t.kicker.news} />
          <article data-sport={sport?.accentToken} className={`group ${CARD}`}>
            <Meta>
              {n.source}
              {n.publishedAt && (
                <>
                  {dot}
                  {formatDay(n.publishedAt)}
                </>
              )}
            </Meta>
            <h3 className="text-lg leading-snug font-bold group-hover:text-accent-ink">
              <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className={STRETCHED}>
                {n.title}
                <span className="sr-only"> {t.news.opensSource}</span>
              </a>
            </h3>
          </article>
        </>
      );
    }
  }
}

export function FeedList({ items, nowMs }: { items: FeedItem[]; nowMs: number }) {
  return (
    <ol className="grid gap-5">
      {items.map((item) => (
        <li key={item.key} className="grid gap-1.5">
          <Entry item={item} nowMs={nowMs} />
        </li>
      ))}
    </ol>
  );
}

/** Nothing to show yet: point to the catalog and to the preferences. */
export function FeedEmpty() {
  const t = getMessages().feed.empty;
  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-dashed border-line p-5">
      <p className="font-bold">{t.title}</p>
      <p className="text-ink-soft">{t.text}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/concours" variant="primary">
          <Icon name="search" size={20} />
          {t.catalog}
        </ButtonLink>
        <ButtonLink href="/profil" variant="outline">
          {t.prefs}
        </ButtonLink>
      </div>
    </div>
  );
}
