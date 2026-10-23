import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { videos } from "@/i18n/fr/videos";

/**
 * Task P3 (lot 2): the videos show pétanque only (no ball of football, no other
 * sport), the draws in the format of the public page with the B and C
 * tournaments, the boule of the landing page; subtitles and transcripts follow
 * apps/videos/src/data/script.json; the re-rendered MP4 files stay within 10 %
 * of the weight of the previous version.
 */
const repo = join(__dirname, "../../../../..");
const videosApp = join(repo, "apps/videos");
const publicVideos = join(repo, "apps/web/public/videos");
const script = JSON.parse(readFileSync(join(videosApp, "src/data/script.json"), "utf8")) as Record<
  "decouverte" | "tutoriel",
  { shots: { start: number; end: number; screen: string; voice: string }[] }
>;

const FOOTBALL = /foot|ballon|soccer|pitch|terrain de foot/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|json)$/.test(name) ? [path] : [];
  });
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Every text of an i18n object (values only: a key such as « footerLink » is not a text). */
const texts = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(texts) : [];

describe("videos: pétanque only", () => {
  it("no football in the code, the script, the subtitles nor the transcripts of the videos", () => {
    const hits = sources(join(videosApp, "src")).filter((file) => FOOTBALL.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
    for (const file of ["decouverte.vtt", "tutoriel.vtt"]) expect(readFileSync(join(publicVideos, file), "utf8")).not.toMatch(FOOTBALL);
    expect(texts(videos).filter((text) => FOOTBALL.test(text))).toEqual([]);
    expect(readFileSync(join(repo, "docs/videos/voix-off.md"), "utf8")).not.toMatch(FOOTBALL);
  });

  it("the storyboard no longer describes a football shot (only the version note says it was removed)", () => {
    const body = readFileSync(join(repo, "docs/videos/storyboard.md"), "utf8")
      .split("\n")
      .filter((line) => !line.startsWith(">"));
    expect(body.filter((line) => FOOTBALL.test(line))).toEqual([]);
  });

  it("shows the draws in the new format, with the cadrage, « Office » and the B and C tournaments", () => {
    const decouverte = readFileSync(join(videosApp, "src/scenes/Decouverte.tsx"), "utf8");
    const screens = readFileSync(join(videosApp, "src/ui/screens.tsx"), "utf8");
    expect(screens).toMatch(/>Terrain<[\s\S]*>Équipe<[\s\S]*>Équipe<[\s\S]*>Score</);
    expect(screens).toContain("Office");
    for (const title of ["Concours A · Résultats Cadrage", "Concours B · Résultats 1re partie", "Concours C · Résultats 1re partie"])
      expect(decouverte).toContain(title);
    expect(script.decouverte.shots.find((s) => s.start === 47)?.voice).toMatch(/cadrage.*concours B et C/i);
  });

  it("uses the boule of the landing page (dark silver, engraved ORGASPORT), not a grooved steel ball", () => {
    const world = readFileSync(join(videosApp, "src/three/world.tsx"), "utf8");
    expect(world).toMatch(/from "\.\.\/\.\.\/\.\.\/web\/src\/components\/vitrine\/ballModel"/);
    expect(world).toContain("steelMaterial(");
    expect(world).not.toMatch(/GROOVES|bouleBump/);
  });
});

describe("videos: subtitles and transcripts follow the script", () => {
  it("the transcripts of /decouvrir are the voice-over of script.json, shot by shot", () => {
    expect(videos.discovery.transcript).toEqual(script.decouverte.shots.map((s) => s.voice));
    expect(videos.tutorial.transcript).toEqual(script.tutoriel.shots.map((s) => s.voice));
  });

  it("each WebVTT file carries every sentence of its video, in order", () => {
    for (const [file, key] of [
      ["decouverte.vtt", "decouverte"],
      ["tutoriel.vtt", "tutoriel"],
    ] as const) {
      const cues = flat(
        readFileSync(join(publicVideos, file), "utf8")
          .split("\n")
          .filter((line) => line && !/^(WEBVTT|Kind:|Language:|\d+$|\d\d:\d\d)/.test(line))
          .join(" "),
      );
      let from = 0;
      for (const shot of script[key].shots) {
        const at = cues.indexOf(flat(shot.voice), from);
        expect(at, `${file}: ${shot.voice}`).toBeGreaterThanOrEqual(0);
        from = at + 1;
      }
    }
  });
});

describe("videos: weight of the rendered files", () => {
  // Weights of the previous render (lot 1, 13–14 Oct. 2026), in bytes.
  const BEFORE: Record<string, number> = {
    "decouverte-16x9.mp4": 8_811_555,
    "decouverte-9x16.mp4": 8_064_556,
    "tutoriel-16x9.mp4": 11_455_803,
    "tutoriel-9x16.mp4": 10_628_198,
  };
  it.each(Object.keys(BEFORE))("%s exists and weighs at most 10 %% more than before", (file) => {
    const path = join(publicVideos, file);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThanOrEqual(BEFORE[file] * 1.1);
  });

  // A file left from lot 1 (football tile, grooved ball, old draws) still has the
  // exact weight of lot 1: every video and its poster must have been rendered again.
  const POSTERS_BEFORE: Record<string, number> = { "tutoriel-16x9.jpg": 51_725, "tutoriel-9x16.jpg": 42_910 };
  it.each([...Object.entries(BEFORE), ...Object.entries(POSTERS_BEFORE)])("%s has been rendered again (not the lot 1 file)", (file, size) => {
    expect(statSync(join(publicVideos, file)).size).not.toBe(size);
  });
});
