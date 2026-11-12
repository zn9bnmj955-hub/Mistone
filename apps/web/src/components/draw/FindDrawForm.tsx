import { Icon } from "@orgasport/ui";
import { getMessages } from "@/i18n";
import { cn } from "@/components/ui/cn";
import { QrScanButton } from "./QrScanButton";

/**
 * "Retrouver mon tirage": a plain GET form, so it works before (and without)
 * JavaScript. The QR scan button is an enhancement.
 *
 * Tones: "surface" (app pages), "inverse" (solid banner), "stage" (dark glass card with a
 * neon edge, laid on the landing's night scene; its `ld-find*` rules live in landing.css,
 * which only the landing page loads).
 */
export function FindDrawForm({
  tone = "inverse",
  defaultValue,
  error,
  autoFocus = false,
  headingLevel = "h2",
}: {
  tone?: "inverse" | "surface" | "stage";
  defaultValue?: string;
  error?: string;
  autoFocus?: boolean;
  headingLevel?: "h1" | "h2";
}) {
  const m = getMessages().findDraw;
  const Heading = headingLevel;
  const inverse = tone === "inverse";
  const stage = tone === "stage";
  return (
    <form
      action="/tirage/aller"
      method="get"
      role="search"
      className={cn(
        "grid gap-3 rounded-[var(--radius-lg)] p-4",
        stage ? "ld-find text-ink" : inverse ? "bg-inverse text-on-inverse" : "border-2 border-ink bg-surface text-ink",
      )}
    >
      <Heading className="display text-[1.75rem]">{m.title}</Heading>
      <label htmlFor="find-code" className="sr-only">
        {m.label}
      </label>
      <div className="flex gap-2">
        <input
          id="find-code"
          name="code"
          defaultValue={defaultValue}
          placeholder={m.placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={60}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby="find-code-desc"
          className={cn(
            "min-h-14 w-full min-w-0 flex-1 rounded-[var(--radius)] px-4 text-xl font-bold uppercase tracking-[0.2em] text-ink tabular placeholder:font-semibold placeholder:normal-case placeholder:tracking-normal",
            stage ? "ld-findField placeholder:text-ink-soft" : "border-0 bg-bg placeholder:text-ink-soft/70",
          )}
        />
        <QrScanButton
          className={stage ? "ld-findScan grid min-h-14 w-14 place-items-center rounded-[var(--radius)] text-accent-ink" : undefined}
          labels={{ scan: m.scan, title: m.scanTitle, help: m.scanHelp, unsupported: m.scanUnsupported, denied: m.scanDenied, close: getMessages().common.close }} />
        <button
          type="submit"
          className={cn("inline-flex min-h-14 items-center gap-1 rounded-[var(--radius)] bg-accent px-4 font-bold text-on-accent", stage && "ld-findSubmit")}
        >
          {m.submit}
          <span className={stage ? "ld-findArrow" : undefined} style={{ display: "inline-flex" }}>
            <Icon name="arrowRight" size={20} />
          </span>
        </button>
      </div>
      <p id="find-code-desc" className={cn("text-sm", error ? "font-bold" : inverse ? "opacity-75" : "text-ink-soft")} role={error ? "alert" : undefined}>
        {error ?? m.hint}
      </p>
    </form>
  );
}
