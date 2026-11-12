import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Icon } from "@orgasport/ui";
import { getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { SportBar } from "@/components/shell/SportBar";
import { NextMatchCard } from "@/components/draw/NextMatchCard";
import { NotifyButton } from "@/components/notifications/NotifyButton";
import { FeedEmpty, FeedList } from "@/components/feed/FeedList";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Note, Section, Skeleton } from "@/components/ui/Section";
import { buildFeed } from "@/lib/data/feed";
import { getMyNextMatch, listClubTournaments } from "@/lib/data/tournaments";
import { parseFeedPrefs } from "@/lib/feed/rank";
import { formatDay } from "@/lib/format";
import { ALL_SPORTS } from "@/lib/prefs";
import { getDevicePrefs, getFeedSports, getSportFilter, getViewer, type Viewer } from "@/lib/viewer";

export const metadata: Metadata = { title: getMessages().nav.home };

/** Request time, read after connection() (kept out of the component body for the purity rule). */
const requestTime = () => Date.now();

/** Statuses shown in the club block: what is running or coming (finished ones live in the club space). */
const CLUB_ACTIVE = new Set(["live", "check_in", "registration_closed", "published", "draft"]);

/** Club mode: the club's live and upcoming tournaments with their registration counts, then the feed. */
async function ClubBlock({ viewer }: { viewer: Viewer }) {
  const m = getMessages();
  const t = m.home.clubHome;
  const club = viewer.activeClub!;
  const tournaments = (await listClubTournaments(club.id)).filter((x) => CLUB_ACTIVE.has(x.status));
  return (
    <Section
      title={t.title}
      action={
        <ButtonLink href="/club/concours/nouveau" variant="primary">
          <Icon name="plus" size={20} />
          {t.create}
        </ButtonLink>
      }
    >
      {tournaments.length === 0 ? (
        <Note>{t.empty}</Note>
      ) : (
        <ul className="grid gap-2">
          {tournaments.map((x) => {
            const sport = getSport(x.sport_slug);
            return (
              <li key={x.id}>
                <Link
                  href={`/club/concours/${x.id}`}
                  data-sport={sport?.accentToken}
                  className="flex min-h-12 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-lift"
                >
                  <Icon name={sport?.icon ?? "all"} />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-bold">{x.name}</span>
                    <span className="text-sm text-ink-soft tabular">
                      {formatDay(x.starts_at)} ·{" "}
                      {x.max_teams
                        ? fmt(m.feed.club.registeredMax, { count: x.teamCount, max: x.max_teams })
                        : fmt(m.feed.club.registered, { count: x.teamCount })}
                    </span>
                  </span>
                  <Badge tone={x.status === "live" ? "live" : x.status === "draft" ? "warning" : "neutral"}>{m.status[x.status]}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** Greeting, then the pinned « En direct » card (or the club block): streamed before the feed. */
async function Head() {
  const m = getMessages();
  const viewer = await getViewer();
  const next = viewer && !viewer.activeClub ? await getMyNextMatch(viewer.id) : null;
  const name = viewer?.profile?.display_name?.split(" ")[0];
  return (
    <>
      <h1 className="display text-4xl">{name ? fmt(m.home.greeting, { name }) : m.home.greetingGuest}</h1>
      {next && (
        <>
          <NextMatchCard match={next} />
          {/* « À vous ! » on this phone for every tournament of the account. */}
          <NotifyButton texts={m.notifications} />
        </>
      )}
      {viewer?.activeClub && <ClubBlock viewer={viewer} />}
    </>
  );
}

/** The ranked feed, from the profile (or the device preferences for a guest). */
async function Feed() {
  const m = getMessages();
  await connection(); // request-time data: dates relative to now, cookies, session
  const nowMs = requestTime();
  const viewer = await getViewer();
  const [sports, device, filter] = await Promise.all([getFeedSports(viewer), getDevicePrefs(), getSportFilter()]);
  const where = viewer?.profile?.lat != null ? viewer.profile : device;
  const items = await buildFeed({
    viewer,
    sports,
    strictSports: filter !== ALL_SPORTS,
    where,
    radiusKm: viewer?.profile?.search_radius_km ?? device?.radiusKm ?? 30,
    prefs: parseFeedPrefs(viewer?.profile?.feed_prefs),
    nowMs,
  });

  return (
    <div className="grid gap-6">
      <Section
        title={m.feed.title}
        action={
          <Link href="/concours" className="inline-flex min-h-12 items-center text-sm font-bold text-accent-ink">
            {m.feed.seeCatalog}
          </Link>
        }
      >
        {items.length > 0 ? <FeedList items={items} nowMs={nowMs} /> : <FeedEmpty />}
      </Section>
      {!viewer && (
        <div className="grid gap-3 rounded-[var(--radius-lg)] border-2 border-ink p-4">
          <p>{m.home.createAccountNudge}</p>
          <ButtonLink href="/connexion?mode=signup" variant="inverse" className="justify-self-start">
            {m.home.createAccount}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="grid gap-6">
      <SportBar />
      <Suspense fallback={<Skeleton className="h-10 w-48" />}>
        <Head />
      </Suspense>
      <Suspense
        fallback={
          <div className="grid gap-4">
            <Skeleton className="h-44" />
            <Skeleton className="h-28" />
            <Skeleton className="h-44" />
          </div>
        }
      >
        <Feed />
      </Suspense>
    </div>
  );
}
