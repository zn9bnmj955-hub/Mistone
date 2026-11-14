import type { CSSProperties } from "react";
import { Icon } from "@orgasport/ui";
import { cn } from "@/components/ui/cn";
import { ButtonLink } from "@/components/ui/Button";
import { StaticFloor } from "./SportHero";
import styles from "./landingStyles";

/** Rank of an element among those that appear together on scroll (landing.css, `.ld-reveal`). */
const lag = (rank: number) => ({ "--ld-i": rank }) as CSSProperties;

/**
 * Last band of a showcase page, for clubs: back on the night stage of the landing (sky, horizon,
 * neon floor), whatever the theme. Goes last inside `<main>`, full width, followed by the footer
 * wrapped in `data-scheme="stage"` so the page ends in the same night.
 */
export function ClubBand({ title, text, button }: { title: string; text: string; button: string }) {
  return (
    <>
      <div className={cn(styles.shore, styles.shoreDown)} aria-hidden="true" />
      <section data-scheme="stage" aria-labelledby="clubs" className={cn(styles.band, "text-ink")}>
        <div className={styles.bandSky} aria-hidden="true">
          <div className={styles.stars} />
          <div className={styles.horizon} />
          <div className={cn(styles.floor, styles.bandFloor)}>
            <StaticFloor />
          </div>
        </div>
        <div className="mx-auto grid max-w-3xl justify-items-center gap-4 px-4 text-center">
          <h2 id="clubs" className={cn(styles.reveal, "display text-[2.75rem] sm:text-6xl")}>{title}</h2>
          <p className={cn(styles.reveal, "max-w-[40ch] text-lg text-ink-soft")} style={lag(1)}>{text}</p>
          <div className={cn(styles.reveal, "mt-3 w-full sm:w-auto")} style={lag(2)}>
            <ButtonLink href="/inscription/club" size="lg" className={cn(styles.bandButton, "w-full sm:w-auto")}>
              {button}
              <Icon name="arrowRight" size={22} />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
