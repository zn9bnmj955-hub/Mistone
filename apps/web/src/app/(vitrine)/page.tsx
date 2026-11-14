import Link from "next/link";
import { Suspense, type CSSProperties } from "react";
import { enabledSports } from "@orgasport/sports";
import { Icon, LogoMark, Wordmark } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { FindDrawForm } from "@/components/draw/FindDrawForm";
import { ClubBand } from "@/components/vitrine/ClubBand";
import { SiteFooter } from "@/components/vitrine/SiteFooter";
import { BallHint, BallSpot, SportHero } from "@/components/vitrine/SportHero";
import styles from "@/components/vitrine/landingStyles";
import { cn } from "@/components/ui/cn";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { getLiveStats } from "@/lib/data/tournaments";
import { formatCount } from "@/lib/format";

/** Rank of an element in the arrival cascade (landing.css): on phones, then on wide screens. */
const step = (phone: number, wide: number = phone) => ({ "--ld-m": phone, "--ld-d": wide }) as CSSProperties;

/** Rank of an element among those that appear together on scroll (landing.css, `.ld-reveal`). */
const lag = (rank: number) => ({ "--ld-i": rank }) as CSSProperties;

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
      {items.map((i, n) => (
        <div key={i.label} className={cn(styles.in, "rounded-[var(--radius)] border border-line bg-surface p-3")} style={step(7 + n, 6 + n)}>
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
        <div className={cn(styles.in, "mx-auto flex max-w-6xl items-center justify-between px-4 py-4")} data-in="drop" style={step(0)}>
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
          className="mx-auto grid max-w-6xl gap-6 px-4 pb-14 pt-2 lg:min-h-[calc(100svh-4.25rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-12 lg:pb-20 lg:pt-8"
        >
          <div className="contents lg:col-start-2 lg:row-start-1 lg:grid lg:gap-4">
            <div className={cn(styles.in, "order-1")} data-in="glass" style={step(0, 2)}>
              <FindDrawForm tone="stage" headingLevel="h2" />
            </div>
            <div className="order-3 grid gap-1">
              <BallSpot description={h.ballDescription} />
              <BallHint hint={h.dragHint} />
            </div>
          </div>
          <div className="contents lg:col-start-1 lg:row-start-1 lg:grid lg:gap-6">
            <div className="order-2 grid gap-3">
              <h1 className={cn(styles.in, "display text-[3.25rem] sm:text-7xl lg:text-[5.25rem]")} data-in="depth" style={step(1, 0)}>
                {h.titleLead} <span className={`${styles.highlight} text-accent-ink`}>{h.titleHighlight}</span>
              </h1>
              <p className={cn(styles.in, "max-w-[46ch] text-lg text-ink-soft")} style={step(2, 1)}>{l.heroText}</p>
            </div>
            <ul className="order-4 grid gap-3">
              {doors.map((d, i) => (
                <li key={d.href} className={styles.in} style={step(4 + i, 3 + i)}>
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
          <a href="#how" className={cn(styles.cue, styles.in)} style={step(10, 9)}>
            {l.howTitle}
            <span className={styles.cueArrow} aria-hidden="true" />
          </a>
        </SportHero>
        <div className={styles.shore} aria-hidden="true" />

        <div className="mx-auto grid max-w-5xl gap-16 px-4 pb-4 pt-4 md:gap-20">
          <section aria-labelledby="how" className="grid gap-8 md:gap-10">
            <h2 id="how" className={cn(styles.reveal, "display text-4xl md:text-center md:text-5xl")}>{l.howTitle}</h2>
            {/* Three stops on one neon line (landing.css): vertical on phones, horizontal on wide screens. */}
            <ol className={styles.steps}>
              {l.how.map((item, i) => (
                <li key={item.title} className={cn(styles.step, styles.reveal)} style={lag(i + 1)}>
                  <span className={cn(styles.stepNode, "display tabular")}>{i + 1}</span>
                  <div className="grid content-start gap-2">
                    <h3 className="text-lg font-bold">{item.title}</h3>
                    <p className="text-ink-soft">{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="video" className="grid gap-6 md:justify-items-center">
            <h2 id="video" className={cn(styles.reveal, "display text-4xl md:text-center md:text-5xl")}>{l.videoTitle}</h2>
            <div className={cn(styles.screen, styles.reveal, "w-full max-w-3xl")} style={lag(1)}>
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
            <Link href="/decouvrir" className={cn(styles.reveal, "flex min-h-12 items-center gap-2 justify-self-start font-bold underline-offset-4 hover:underline md:justify-self-center")}>
              {v.landingLink}
              <Icon name="arrowRight" size={20} />
            </Link>
          </section>
        </div>

        {/* Back into the night: the page ends on the same stage as the arrival. */}
        <ClubBand title={l.clubCta} text={l.clubCtaText} button={l.clubCtaButton} />
      </main>
      <div data-scheme="stage" className="bg-bg text-ink">
        <SiteFooter />
      </div>
    </>
  );
}
