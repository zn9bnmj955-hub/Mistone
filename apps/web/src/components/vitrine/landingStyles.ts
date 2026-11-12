import "./landing.css";

/**
 * Class names of landing.css (plain CSS with an `ld-` prefix: the Turbopack
 * rule for `*.css` in next.config.ts turns CSS modules into global CSS).
 */
const styles = {
  backdrop: "ld-backdrop",
  ballSpot: "ld-ballSpot",
  canvasHost: "ld-canvasHost",
  door: "ld-door",
  doorArrow: "ld-doorArrow",
  floor: "ld-floor",
  header: "ld-header",
  hero: "ld-hero",
  highlight: "ld-highlight",
  horizon: "ld-horizon",
  rise: "ld-rise",
  shore: "ld-shore",
  stars: "ld-stars",
  still: "ld-still",
  veil: "ld-veil",
} as const;

export default styles;
