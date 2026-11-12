/** Where to go when a requested redirect target is missing or unsafe. */
export const DEFAULT_AFTER_LOGIN = "/accueil";

/** Placeholder origin used when the caller has none (the check is relative). */
const PLACEHOLDER_ORIGIN = "https://orgasport.invalid";

const MAX_LENGTH = 2048;

// C0/C1 control characters and Unicode line separators.
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

/**
 * Rejects what a browser may read as another site or what could split a
 * header: protocol-relative "//", backslashes ("/\evil.com" is "//evil.com"
 * for a browser), control characters (tab, CR, LF, NUL…) and raw spaces.
 */
function looksUnsafe(path: string, allowSpace = false): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return true;
  if (path.includes("\\")) return true;
  if (!allowSpace && path.includes(" ")) return true;
  return CONTROL.test(path);
}

/**
 * The only way to turn a user-supplied `next` (login page, auth callback,
 * sign-in form) into a redirect target: returns a path on our own site
 * ("/club?x=1#y"), otherwise `fallback`. The once-decoded value is checked
 * too ("/%2F%2Fevil.com", "/%5Cevil.com"), then the path is resolved against
 * `origin` and must stay on it.
 */
export function safeInternalPath(
  next: string | null | undefined,
  origin: string = PLACEHOLDER_ORIGIN,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_LENGTH) return fallback;
  if (looksUnsafe(next)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  // An encoded space ("%20") is harmless; an encoded "/", "\" or control character is not.
  if (looksUnsafe(decoded, true)) return fallback;
  try {
    const base = new URL(origin);
    const url = new URL(next, base);
    if (url.origin !== base.origin) return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return looksUnsafe(path) ? fallback : path;
  } catch {
    return fallback;
  }
}
