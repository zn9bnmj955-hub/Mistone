import { describe, expect, it } from "vitest";
import { buttonClass } from "./Button";
import { DISABLED_BORDERED, DISABLED_PLAIN } from "./disabled";

// Un bouton désactivé reste lisible : fond surface-2, texte ink-soft, bordure line.
// Jamais d'opacité réduite (texte à 2:1) ni de couleur translucide (table de marque, Chrome 109).

describe("état désactivé des boutons", () => {
  const variants = ["primary", "inverse", "outline", "ghost", "danger"] as const;

  it.each([DISABLED_BORDERED, DISABLED_PLAIN])("uses the surface-2 / ink-soft / line tokens, at full opacity", (cls) => {
    const parts = cls.split(" ");
    expect(parts).toEqual(expect.arrayContaining(["disabled:cursor-not-allowed", "disabled:bg-surface-2", "disabled:text-ink-soft", "disabled:opacity-100"]));
    expect(cls).toMatch(/disabled:border-line|var\(--os-line\)/);
    expect(parts.every((p) => p.startsWith("disabled:"))).toBe(true);
    expect(cls).not.toMatch(/\/\d|color-mix|rgba?\(|#[0-9a-f]{3}/i);
  });

  it.each(variants)("button « %s » never fades when disabled", (variant) => {
    const cls = buttonClass(variant);
    expect(cls).toContain("disabled:bg-surface-2");
    expect(cls).toContain("disabled:text-ink-soft");
    expect(cls).not.toMatch(/disabled:opacity-(?!100)/);
  });

  it("keeps the border of the outline button and draws one inside the others", () => {
    expect(buttonClass("outline")).toContain("disabled:border-line");
    expect(buttonClass("primary")).toContain("disabled:shadow-[inset_0_0_0_2px_var(--os-line)]");
  });
});
