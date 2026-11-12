import "./landing.css";

/**
 * Class names of landing.css (plain CSS with an `ld-` prefix: the Turbopack
 * rule for `*.css` in next.config.ts turns CSS modules into global CSS).
 */
const styles = {
  backdrop: "ld-backdrop",
  band: "ld-band",
  bandButton: "ld-bandButton",
  bandFloor: "ld-bandFloor",
  bandSky: "ld-bandSky",
  ballSpot: "ld-ballSpot",
  canvasHost: "ld-canvasHost",
  cue: "ld-cue",
  cueArrow: "ld-cueArrow",
  door: "ld-door",
  doorArrow: "ld-doorArrow",
  floor: "ld-floor",
  header: "ld-header",
  hero: "ld-hero",
  highlight: "ld-highlight",
  horizon: "ld-horizon",
  in: "ld-in",
  reveal: "ld-reveal",
  screen: "ld-screen",
  shore: "ld-shore",
  shoreDown: "ld-shoreDown",
  stars: "ld-stars",
  step: "ld-step",
  stepNode: "ld-stepNode",
  steps: "ld-steps",
  still: "ld-still",
  veil: "ld-veil",
} as const;

export default styles;
