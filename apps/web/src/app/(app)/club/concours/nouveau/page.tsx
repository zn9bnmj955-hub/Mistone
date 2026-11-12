import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { enabledSports, getSport } from "@orgasport/sports";
import { Icon } from "@orgasport/ui";
import { getMessages } from "@/i18n";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Section";
import { SportPicker, type SportOption } from "@/components/tournament-form/SportPicker";
import { createClient } from "@/lib/supabase/server";
import { formatDay } from "@/lib/format";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: getMessages().wizard.title, robots: { index: false } };

const option = (s: NonNullable<ReturnType<typeof getSport>>): SportOption => ({ slug: s.slug, name: s.name, icon: s.icon, accentToken: s.accentToken });

async function Start() {
  const t = getMessages().wizard.start;
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <Card className="grid gap-3">
        <h2 className="text-xl font-black">{t.signInTitle}</h2>
        <p>{t.signIn}</p>
        <ButtonLink href={`/connexion?next=${encodeURIComponent("/club/concours/nouveau")}`} className="justify-self-start">
          {t.signInButton}
        </ButtonLink>
      </Card>
    );
  }

  const club = viewer.activeClub;
  if (!club) {
    return (
      <Card className="grid gap-3">
        <h2 className="text-xl font-black">{t.noClubTitle}</h2>
        <p>{t.noClub}</p>
        <div className="flex flex-wrap gap-2">
          {viewer.clubs.length > 0 && <ButtonLink href="/profil">{t.switchProfile}</ButtonLink>}
          <ButtonLink href="/inscription/club" variant={viewer.clubs.length > 0 ? "outline" : "primary"}>
            {t.createClub}
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const supabase = await createClient();
  const [{ data: clubRow }, { data: drafts }] = await Promise.all([
    supabase.from("clubs").select("sports").eq("id", club.id).maybeSingle(),
    supabase.from("tournaments").select("id, name, sport_slug, updated_at").eq("club_id", club.id).eq("status", "draft").order("updated_at", { ascending: false }).limit(3),
  ]);

  // The club's own sports first, then every other sport we offer.
  const enabled = enabledSports();
  const mine = (clubRow?.sports ?? []).map(getSport).filter((s): s is NonNullable<typeof s> => Boolean(s?.enabled));
  const others = enabled.filter((s) => !mine.some((m) => m.slug === s.slug));
  const groups = mine.length
    ? [
        { title: t.yourSports, sports: mine.map(option) },
        ...(others.length ? [{ title: t.otherSports, sports: others.map(option) }] : []),
      ]
    : [{ title: t.pickSport, sports: enabled.map(option) }];

  return (
    <div className="grid gap-8">
      <p className="text-lg text-ink-soft">{enabled.length > 1 ? t.pickSportText : t.singleSportText}</p>
      <SportPicker groups={groups} />
      {drafts && drafts.length > 0 && (
        <section aria-labelledby="drafts" className="grid gap-3">
          <h2 id="drafts" className="eyebrow">
            {t.drafts}
          </h2>
          <ul className="grid gap-2">
            {drafts.map((d) => {
              const sport = getSport(d.sport_slug);
              return (
                <li key={d.id}>
                  <Link
                    href={`/club/concours/${d.id}/modifier`}
                    data-sport={sport?.accentToken}
                    className="flex min-h-16 items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-lift"
                  >
                    <Icon name={sport?.icon ?? "all"} className="shrink-0 text-accent-ink" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-bold">{d.name}</span>
                      <span className="text-sm text-ink-soft">{formatDay(d.updated_at)}</span>
                    </span>
                    <span className="text-sm font-bold text-accent-ink">{t.continue}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "Créer un concours", step 0: pick the sport, the draft is created right away. */
export default function NewTournamentPage() {
  return (
    <div className="grid gap-6">
      <h1 className="display text-5xl">{getMessages().wizard.title}</h1>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Start />
      </Suspense>
    </div>
  );
}
