import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getSport } from "@orgasport/sports";
import { Icon } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Note, Section, Skeleton } from "@/components/ui/Section";
import { ActionForm } from "@/components/club/ActionForm";
import { AutoRefresh } from "@/components/club/AutoRefresh";
import { ClubLogo } from "@/components/club/ClubLogo";
import { ClubPageHeader } from "@/components/club/ClubPageHeader";
import { NoClub } from "@/components/club/NoClub";
import { formatLongDate, groupClubTournaments } from "@/components/club/model";
import { clubLogoUrl, getClubContext, listDashboardTournaments, type DashboardTournament } from "@/lib/data/clubs";
import { formatDay, formatTime } from "@/lib/format";
import { getViewer } from "@/lib/viewer";
import { deleteDraft } from "./actions";

export const metadata: Metadata = { title: getMessages().club.title, robots: { index: false } };

function whenOf(iso: string | null): string {
  if (!iso) return "";
  return fmt(getMessages().clubSpace.dashboard.when, { day: formatDay(iso), time: formatTime(iso) });
}

function registrationsOf(t: DashboardTournament): string {
  const r = getMessages().clubSpace.manage.registrations;
  return t.max_teams ? fmt(r.summaryMax, { count: t.activeTeams, max: t.max_teams }) : fmt(r.summary, { count: t.activeTeams });
}

/** One tournament: sport, name, date, live counts, then its shortcuts. */
function TournamentRow({ t, children, counts = true }: { t: DashboardTournament; children: ReactNode; counts?: boolean }) {
  const m = getMessages();
  const sport = getSport(t.sport_slug);
  return (
    <li data-sport={sport?.accentToken} className="grid gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-depth">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent-ink">
          <Icon name={sport?.icon ?? "all"} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="font-bold">{t.name || m.status.draft}</p>
          {t.starts_at && <p className="text-sm text-ink-soft tabular">{whenOf(t.starts_at)}</p>}
          {counts && (
            <p className="text-sm tabular">
              <span className="font-semibold">{registrationsOf(t)}</span>
              {t.waitlistTeams > 0 && <span className="text-ink-soft"> {fmt(m.clubSpace.dashboard.waitlist, { count: t.waitlistTeams })}</span>}
            </p>
          )}
        </div>
        <Badge tone={t.status === "live" ? "live" : t.status === "published" ? "accent" : "neutral"}>{m.status[t.status]}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function List({ items, empty, children }: { items: DashboardTournament[]; empty: string; children: (t: DashboardTournament) => ReactNode }) {
  if (items.length === 0) return <p className="text-ink-soft">{empty}</p>;
  return <ul className="grid gap-3">{items.map((t) => children(t))}</ul>;
}

async function Dashboard() {
  const m = getMessages();
  const t = m.clubSpace.dashboard;
  const ctx = await getClubContext();
  if (!ctx) return <NoClub viewer={await getViewer()} />;
  const { club, isAdmin } = ctx;
  const { current, drafts, past } = groupClubTournaments(await listDashboardTournaments(club.id));
  const small = buttonClass("outline");

  return (
    <div className="grid gap-8">
      <Card className="flex flex-wrap items-center gap-4">
        <ClubLogo url={clubLogoUrl(club.logo_path)} name={club.name} alt={fmt(m.clubSpace.logoAlt, { club: club.name })} />
        <div className="grid min-w-0 flex-1 basis-48 gap-1">
          <p className="display text-3xl text-accent-ink">{club.name}</p>
          <Link href={`/clubs/${club.slug}`} className="inline-flex min-h-10 items-center gap-1.5 justify-self-start text-sm font-bold underline-offset-4 hover:underline">
            <Icon name="club" size={18} />
            {t.publicPage}
          </Link>
          <Link href="/decouvrir#tutoriel" className="inline-flex min-h-10 items-center gap-1.5 justify-self-start text-sm font-bold underline-offset-4 hover:underline">
            <Icon name="arrowRight" size={18} />
            {m.videos.clubLink}
          </Link>
        </div>
        <ButtonLink href="/club/concours/nouveau">
          <Icon name="plus" size={20} />
          {t.create}
        </ButtonLink>
      </Card>

      <Section title={t.current.title}>
        <List items={current} empty={t.current.empty}>
          {(row) => (
            <TournamentRow key={row.id} t={row}>
              <Link href={`/club/concours/${row.id}`} className={buttonClass("primary")}>
                {t.links.manage}
              </Link>
              <a href={`/c/${row.short_code}`} className={small}>
                {t.links.public}
              </a>
              <a href={`/c/${row.short_code}/table`} className={small}>
                {t.links.table}
              </a>
            </TournamentRow>
          )}
        </List>
        {current.length > 0 && (
          <>
            <Note>{t.refreshNote}</Note>
            <AutoRefresh seconds={30} />
          </>
        )}
      </Section>

      <Section title={t.drafts.title}>
        <List items={drafts} empty={t.drafts.empty}>
          {(row) => (
            <TournamentRow key={row.id} t={row} counts={false}>
              {row.updated_at && <p className="basis-full text-sm text-ink-soft">{fmt(t.drafts.updated, { date: formatLongDate(row.updated_at) })}</p>}
              <Link href={`/club/concours/${row.id}/modifier`} className={buttonClass("primary")}>
                {t.drafts.continue}
              </Link>
              {isAdmin && (
                <ActionForm
                  action={deleteDraft}
                  fields={{ id: row.id }}
                  confirm={fmt(t.drafts.confirmDelete, { name: row.name || m.status.draft })}
                  className="flex flex-wrap items-center gap-2"
                >
                  <button type="submit" className={buttonClass("danger")}>
                    {t.drafts.delete}
                  </button>
                </ActionForm>
              )}
            </TournamentRow>
          )}
        </List>
      </Section>

      <Section title={t.finished.title}>
        <List items={past} empty={t.finished.empty}>
          {(row) => (
            <TournamentRow key={row.id} t={row}>
              <Link href={`/club/concours/${row.id}`} className={small}>
                {t.links.manage}
              </Link>
              <a href={`/c/${row.short_code}`} className={small}>
                {t.links.public}
              </a>
            </TournamentRow>
          )}
        </List>
      </Section>
    </div>
  );
}

export default function ClubPage() {
  return (
    <div className="grid gap-6">
      <ClubPageHeader title={getMessages().club.title} />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
