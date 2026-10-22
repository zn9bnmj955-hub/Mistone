import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// La table de marque doit rester lisible sur Chrome/Edge 109 (vieux PC Windows 7).
// Tailwind v4 rend « bg-danger/10 » avec color-mix(), absent avant Chrome 111 :
// le fond devient alors la couleur pleine et le texte de même couleur disparaît.
// On utilise donc les jetons pleins « *-soft » (packages/ui/src/tokens.css).

const src = fileURLToPath(new URL("../..", import.meta.url));
const roots = [join(src, "components/table"), join(src, "app/c/[code]/table")];
const tokens = readFileSync(fileURLToPath(new URL("../../../../../packages/ui/src/tokens.css", import.meta.url)), "utf8");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

// Utilitaire de couleur suivi d'une opacité : bg-success/15, hover:border-danger/40, ring-accent/[.3]…
const TRANSLUCENT =
  /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|from|via|to|shadow|fill|stroke|divide|decoration|placeholder|caret|accent)-[a-z][\w-]*\/(?:\d+|\[[^\]]+\])/g;

describe("table de marque : aucune couleur translucide (Chrome 109)", () => {
  it("finds the table source files", () => {
    expect(roots.flatMap(files).length).toBeGreaterThan(5);
  });

  it("uses no Tailwind color with an opacity modifier", () => {
    const found = roots.flatMap(files).flatMap((file) =>
      (readFileSync(file, "utf8").match(TRANSLUCENT) ?? []).map((cls) => `${file.slice(src.length)}: ${cls}`),
    );
    expect(found).toEqual([]);
  });

  it("detects the forbidden pattern", () => {
    expect('"bg-danger/10 hover:bg-accent/40 bg-accent-soft"'.match(TRANSLUCENT)).toEqual(["bg-danger/10", "hover:bg-accent/40"]);
  });

  it("defines the solid soft state colors in light, dark (system and chosen) and stage", () => {
    for (const name of ["success", "warning", "danger"]) {
      const values = [...tokens.matchAll(new RegExp(`--os-${name}-soft:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
      expect(values).toHaveLength(4);
      for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
