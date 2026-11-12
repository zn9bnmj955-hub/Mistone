import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeInternalPath } from "./safe-path";

const ORIGIN = "https://orgasport.fr";

describe("safeInternalPath", () => {
  it("keeps internal paths, with query and hash", () => {
    expect(safeInternalPath("/accueil", ORIGIN)).toBe("/accueil");
    expect(safeInternalPath("/c/7KQ2/table", ORIGIN)).toBe("/c/7KQ2/table");
    expect(safeInternalPath("/inscription/club?reprendre=1", ORIGIN)).toBe("/inscription/club?reprendre=1");
    expect(safeInternalPath("/club/concours/abc/paiement?paiement=x#haut", ORIGIN)).toBe(
      "/club/concours/abc/paiement?paiement=x#haut",
    );
    expect(safeInternalPath("/clubs/p%C3%A9tanque%20club", ORIGIN)).toBe("/clubs/p%C3%A9tanque%20club");
    expect(safeInternalPath("/accueil")).toBe("/accueil");
  });

  it("falls back to /accueil when missing", () => {
    expect(safeInternalPath(null, ORIGIN)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeInternalPath(undefined, ORIGIN)).toBe("/accueil");
    expect(safeInternalPath("", ORIGIN)).toBe("/accueil");
  });

  it("refuses /\\evil.com (constat 31)", () => {
    expect(safeInternalPath("/\\evil.com", ORIGIN)).toBe("/accueil");
    expect(safeInternalPath("/\\evil.com")).toBe("/accueil");
  });

  it.each([
    "//evil.com",
    "//evil.com/accueil",
    "///evil.com",
    "\\\\evil.com",
    "\\/evil.com",
    "/\\/evil.com",
    "/a\\b",
    "http://evil.com",
    "https://evil.com/accueil",
    "HTTPS://evil.com",
    "https:evil.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.com",
    "accueil",
    " /accueil",
    "/accueil ",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\u0000/evil.com",
    "/accueil\r\nSet-Cookie: x=1",
    "/\u2028/evil.com",
  ])("refuses raw %j", (next) => {
    expect(safeInternalPath(next, ORIGIN)).toBe("/accueil");
  });

  it.each([
    "/%2F%2Fevil.com",
    "/%2fevil.com",
    "%2F%2Fevil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "%5C%5Cevil.com",
    "/%09/evil.com",
    "/%0A/evil.com",
    "/%0D/evil.com",
    "/%00/evil.com",
    "/accueil%0D%0ASet-Cookie:%20x=1",
    "/%E2%80%A8/evil.com",
    "/%E0%A4%A", // malformed encoding
  ])("refuses encoded %j", (next) => {
    expect(safeInternalPath(next, ORIGIN)).toBe("/accueil");
  });

  it("keeps the result on the origin after resolution", () => {
    expect(safeInternalPath("/../../accueil", ORIGIN)).toBe("/accueil");
    expect(safeInternalPath("/./club/../profil", ORIGIN)).toBe("/profil");
    // Resolves to the pathname "//evil.com", which a browser would read as another site.
    expect(safeInternalPath("/a/..//evil.com", ORIGIN)).toBe("/accueil");
  });

  it("refuses overly long values", () => {
    expect(safeInternalPath(`/${"a".repeat(3000)}`, ORIGIN)).toBe("/accueil");
  });

  it("accepts a custom fallback", () => {
    expect(safeInternalPath("//evil.com", ORIGIN, "/")).toBe("/");
  });
});
