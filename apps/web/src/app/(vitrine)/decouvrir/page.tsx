import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark, Wordmark } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { VideoPlayer, type VideoFile } from "@/components/video/VideoPlayer";
import { ClubBand } from "@/components/vitrine/ClubBand";
import { SiteFooter } from "@/components/vitrine/SiteFooter";

export const metadata: Metadata = { title: getMessages().videos.page.title, description: getMessages().videos.page.description };

const file = (name: string, orientation: "16x9" | "9x16"): VideoFile => ({
  src: `/videos/${name}-${orientation}.mp4`,
  poster: `/videos/${name}-${orientation}.jpg`,
  width: orientation === "16x9" ? 1280 : 720,
  height: orientation === "16x9" ? 720 : 1280,
});

export default function DiscoverPage() {
  const v = getMessages().videos;
  const p = v.player;
  const labels = (title: string, duration: string) => ({
    play: fmt(p.play, { title, duration }),
    subtitles: p.subtitles,
    chapters: p.chapters,
    chapterAt: p.chapterAt,
    noVideo: p.noVideo,
    download: p.download,
  });
  const videos = [
    { id: "decouverte", ...v.discovery, chapters: undefined },
    { id: "tutoriel", ...v.tutorial },
  ];

  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-ink" aria-label={v.page.home}>
          <LogoMark size={26} />
          <Wordmark className="text-xl" />
        </Link>
      </header>
      <main id="contenu">
        <div className="mx-auto grid max-w-5xl gap-14 px-4 pb-10 pt-4">
          <div className="grid max-w-3xl gap-3">
            <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">{v.page.eyebrow}</p>
            <h1 className="display text-5xl sm:text-6xl">{v.page.title}</h1>
            <p className="text-lg text-ink-soft">{v.page.intro}</p>
          </div>

          {videos.map((video, i) => (
            <section key={video.id} id={video.id} aria-labelledby={`${video.id}-title`} className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
              <VideoPlayer
                title={video.title}
                duration={video.duration}
                priority={i === 0}
                wide={file(video.id, "16x9")}
                tall={file(video.id, "9x16")}
                captions={`/videos/${video.id}.vtt`}
                chapters={video.chapters}
                labels={labels(video.title, video.duration)}
              />
              <div className="grid content-start gap-3">
                <h2 id={`${video.id}-title`} className="display text-4xl">
                  {video.title}
                </h2>
                <p className="text-sm font-bold text-ink-soft tabular">{video.duration}</p>
                <p className="text-ink-soft">{video.text}</p>
                <p className="text-sm text-ink-soft sm:hidden">{p.mobileHint}</p>
                <details className="rounded-[var(--radius)] border border-line bg-surface p-4">
                  <summary className="cursor-pointer font-bold">{p.transcript}</summary>
                  <div className="mt-3 grid gap-2 text-ink-soft">
                    {video.transcript.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </details>
              </div>
            </section>
          ))}
        </div>
        {/* Same ending as the landing: back on the night stage, footer included. */}
        <ClubBand title={v.page.ctaTitle} text={v.page.ctaText} button={v.page.ctaButton} />
      </main>
      <div data-scheme="stage" className="bg-bg text-ink">
        <SiteFooter />
      </div>
    </>
  );
}
