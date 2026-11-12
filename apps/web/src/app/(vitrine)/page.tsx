import Link from "next/link";
import { Suspense, type CSSProperties } from "react";
import { enabledSports } from "@orgasport/sports";
import { Icon, LogoMark, Wordmark } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { FindDrawForm } from "@/components/draw/FindDrawForm";
import { SiteFooter } from "@/components/vitrine/SiteFooter";
import { BallHint, BallSpot, SportHero } from "@/components/vitrine/SportHero";
import styles from "@/components/vitrine/landingStyles";
import { cn } from "@/components/ui/cn";
import { ButtonLink } from "@/components/ui/Button";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { getLiveStats } from "@/lib/data/tournaments";
import { formatCount } from "@/lib/format";

async function LiveNumbers() {
  const m = getMessages().landing;
  const stats = await getLiveStats();
  const items = [
    { value: stats.liveTournaments, label: m.liveTournaments, live: true },
    { value: stats.players, label: m.players },
    { value: stats.upcoming, label: m.upcoming },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((i) => (
        <div key={i.label} className="rounded-[var(--radius)] border border-line bg-surface p-3">
          <dd className="display text-4xl tabular sm:text-5xl">{formatCount(i.value)}</dd>
          <dt className="mt-1 flex items-center gap-1.5 text-xs font-bold text-ink-soft sm:text-sm">
            {i.live && <span className="live-dot" aria-hidden="true" />}
            {i.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

function NumbersFallback() {
  return <div className="h-[92px] rounded-[var(--radius)] bg-surface-2" aria-hidden="true" />;
}

export default function LandingPage() {
  const m = getMessages();
  const l = m.landing;
  const v = m.videos;
  const h = m.landing3d;
  const stageSports = enabledSports().map(({ slug, name, icon, accentToken }) => ({ slug, name, icon, accentToken }));
  const doors = [
    { href: "/inscription/joueur", icon: "petanque", ...l.doors.play, primary: true },
    { href: "/inscription/club", icon: "club", ...l.doors.organize, primary: false },
    { href: "/inscription/invite", icon: "arrowRight", ...l.doors.guest, primary: false },
  ];
  return (
    <>
      {/* Transparent, laid over the top of the night stage (the hero slides up under it: landing.css). */}
      <header data-scheme="stage" className={cn(styles.header, "text-ink")}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-ink" aria-label={m.meta.title}>
            <LogoMark size={30} />
            <Wordmark className="text-2xl" />
          </Link>
          <Link href="/connexion" className="rounded-full px-4 py-2 text-sm font-bold hover:bg-surface-2">
            {l.login}
          </Link>
        </div>
      </header>

      <main id="contenu">
        {/* 1. Full-bleed night stage. The find-my-draw field comes first (DOM order); on phones the
            two column wrappers are `display: contents` and `order-*` interleaves their children. */}
        <SportHero
          sports={stageSports}
          className="mx-auto grid max-w-6xl gap-6 px-4 pb-14 pt-2 lg:min-h-[calc(100svh-4.25rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-12 lg:pt-8"
        >
          <div className="contents lg:col-start-2 lg:row-start-1 lg:grid lg:gap-4">
            <div className="order-1">
              <FindDrawForm tone="stage" headingLevel="h2" />
            </div>
            <div className="order-3 grid gap-1">
              <BallSpot description={h.ballDescription} />
              <BallHint hint={h.dragHint} />
            </div>
          </div>
          <div className="contents lg:col-start-1 lg:row-start-1 lg:grid lg:gap-6">
            <div className="order-2 grid gap-3">
              <h1 className="display text-[3.25rem] sm:text-7xl lg:text-[5.25rem]">
                {h.titleLead} <span className={`${styles.highlight} text-accent-ink`}>{h.titleHighlight}</span>
              </h1>
              <p className="max-w-[46ch] text-lg text-ink-soft">{l.heroText}</p>
            </div>
            <ul className="order-4 grid gap-3">
              {doors.map((d, i) => (
                <li key={d.href} className={styles.rise} style={{ "--rise-delay": `${120 + i * 70}ms` } as CSSProperties}>
                  <Link
                    href={d.href}
                    className={cn(
                      styles.door,
                      d.primary
                        ? "flex min-h-20 items-center gap-4 rounded-[var(--radius-lg)] bg-accent px-5 text-on-accent hover:brightness-105"
                        : "flex min-h-20 items-center gap-4 rounded-[var(--radius-lg)] border-2 border-line bg-surface/85 px-5 hover:border-ink",
                    )}
                  >
                    <span className="grid min-w-0 flex-1">
                      <span className="display text-3xl">{d.title}</span>
                      <span className={d.primary ? "text-sm font-semibold opacity-80" : "text-sm text-ink-soft"}>{d.text}</span>
                    </span>
                    <span className={styles.doorArrow}>
                      <Icon name="arrowRight" size={26} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="order-5">
              <Suspense fallback={<NumbersFallback />}>
                <LiveNumbers />
              </Suspense>
            </div>
          </div>
        </SportHero>
        <div className={styles.shore} aria-hidden="true" />

        <div className="mx-auto grid max-w-5xl gap-14 px-4 pb-16 pt-4">
        <section aria-labelledby="how" className="grid gap-6">
          <h2 id="how" className="display text-4xl">{l.howTitle}</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {l.how.map((step, i) => (
              <li key={step.title} className="grid content-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
                <span className="display text-5xl text-accent-ink tabular">{i + 1}</span>
                <h3 className="text-lg font-bold">{step.title}</h3>
                <p className="text-ink-soft">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="video" className="grid gap-4">
          <h2 id="video" className="display text-4xl">{l.videoTitle}</h2>
          <div className="w-full max-w-3xl">
            <VideoPlayer
              title={v.discovery.title}
              duration={v.discovery.duration}
              wide={{ src: "/videos/decouverte-16x9.mp4", poster: "/videos/decouverte-16x9.jpg", width: 1280, height: 720 }}
              tall={{ src: "/videos/decouverte-9x16.mp4", poster: "/videos/decouverte-9x16.jpg", width: 720, height: 1280 }}
              captions="/videos/decouverte.vtt"
              labels={{
                play: fmt(v.player.play, { title: v.discovery.title, duration: v.discovery.duration }),
                subtitles: v.player.subtitles,
                chapters: v.player.chapters,
                chapterAt: v.player.chapterAt,
                noVideo: v.player.noVideo,
                download: v.player.download,
              }}
            />
          </div>
          <Link href="/decouvrir" className="flex items-center gap-2 justify-self-start font-bold underline-offset-4 hover:underline">
            {v.landingLink}
            <Icon name="arrowRight" size={20} />
          </Link>
        </section>

        <section className="grid gap-4 rounded-[var(--radius-lg)] border-2 border-ink p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid gap-1">
            <h2 className="display text-3xl">{l.clubCta}</h2>
            <p className="text-ink-soft">{l.clubCtaText}</p>
          </div>
          <ButtonLink href="/inscription/club" size="lg" variant="inverse">
            {l.clubCtaButton}
          </ButtonLink>
        </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
