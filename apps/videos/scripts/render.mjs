// Renders the OrgaSport videos into apps/web/public/videos/:
// MP4 (H.264, yuv420p, CRF 28, faststart) + soundtrack, poster JPEG, WebVTT subtitles.
// Usage: node scripts/render.mjs all | <CompositionId>…
// Env: RENDER_CONCURRENCY (default 2), REMOTION_BROWSER_EXECUTABLE (default: auto-detect a
// local Chrome headless shell, otherwise Remotion downloads one), RENDER_FRAMES (e.g. 0-299, for tests).
import { existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "../web/public/videos");
const cache = join(root, ".cache");
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

// budget: at most 10 % above the weight of the lot 1 render (task P3), in bytes.
const VIDEOS = {
  Decouverte169: { file: "decouverte-16x9", music: "decouverte", poster: 71, budget: 9.69e6 },
  Decouverte916: { file: "decouverte-9x16", music: "decouverte", poster: 71, budget: 8.87e6 },
  Tutoriel169: { file: "tutoriel-16x9", music: "tutoriel", poster: 4, budget: 12.6e6 },
  Tutoriel916: { file: "tutoriel-9x16", music: "tutoriel", poster: 4, budget: 11.69e6 },
};

const args = process.argv.slice(2);
const ids = !args.length || args.includes("all") ? Object.keys(VIDEOS) : args;
for (const id of ids) if (!VIDEOS[id]) throw new Error(`Composition inconnue : ${id}`);

const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: "inherit", cwd: root, ...opts });

function browser() {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const base = "/opt/pw-browsers";
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse()) {
    const p = join(base, d, "chrome-linux", "headless_shell");
    if (existsSync(p)) return p;
  }
  return null;
}

// Music and subtitles first (cheap, and always in sync with src/data/script.json).
if (!existsSync(join(root, "public/music/decouverte.mp3")) || !existsSync(join(root, "public/music/tutoriel.mp3")))
  run("node", ["scripts/make-music.mjs"]);
run("node", ["scripts/make-subtitles.mjs"]);

const bundle = join(cache, "bundle");
run("npx", ["remotion", "bundle", "src/index.ts", "--out-dir", bundle]);

const exe = browser();
const concurrency = process.env.RENDER_CONCURRENCY ?? "2";
for (const id of ids) {
  const v = VIDEOS[id];
  const raw = join(cache, `${v.file}.video.mp4`);
  const started = Date.now();
  run("npx", [
    "remotion",
    "render",
    bundle,
    id,
    raw,
    "--muted",
    "--codec=h264",
    "--crf=28",
    "--pixel-format=yuv420p",
    "--x264-preset=medium",
    `--concurrency=${concurrency}`,
    "--gl=swangle",
    ...(process.env.RENDER_FRAMES ? [`--frames=${process.env.RENDER_FRAMES}`] : []),
    ...(exe ? [`--browser-executable=${exe}`] : []),
  ]);
  const mp4 = join(out, `${v.file}.mp4`);
  const tmp = join(cache, `${v.file}.mp4`);
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", raw,
    "-i", join(root, "public/music", `${v.music}.mp3`),
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
    "-movflags", "+faststart",
    tmp,
  ]);
  renameSync(tmp, mp4);
  // Size budget: re-encode the video track with a higher CRF if needed.
  for (const crf of [29, 30, 31, 33, 35, 37]) {
    if (statSync(mp4).size <= v.budget) break;
    run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", raw, "-i", mp4, "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-shortest", "-movflags", "+faststart", tmp,
    ]);
    renameSync(tmp, mp4);
  }
  run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(v.poster), "-i", mp4, "-frames:v", "1", "-q:v", "4", join(out, `${v.file}.jpg`)]);
  const mb = (statSync(mp4).size / 1e6).toFixed(1);
  console.log(`✓ ${v.file}.mp4 — ${mb} Mo, rendu en ${((Date.now() - started) / 60000).toFixed(1)} min`);
}
