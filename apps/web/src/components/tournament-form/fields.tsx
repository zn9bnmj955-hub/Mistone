"use client";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@orgasport/ui";
import { getMessages } from "@/i18n";
import { cn } from "@/components/ui/cn";
import { DISABLED_BORDERED } from "@/components/ui/disabled";

/**
 * Form controls of the creation form: big touch targets, native inputs
 * underneath (keyboard and screen readers work as usual), errors and hints
 * tied to their field.
 */

export function Group({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="grid gap-1">
        <h2 className="text-xl font-black">{title}</h2>
        {text && <p className="text-sm text-ink-soft">{text}</p>}
      </div>
      {children}
    </section>
  );
}

export function Help({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <p id={id} className={cn("text-sm", error ? "font-bold text-danger" : "text-ink-soft")}>
      {error ?? hint}
    </p>
  );
}

const inputClass =
  "w-full rounded-[var(--radius)] border-2 border-line bg-surface px-4 text-base text-ink placeholder:text-ink-soft/70 focus:border-accent aria-[invalid]:border-danger";

export function TextArea({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-desc` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "min-h-12 py-3")}
      />
      <Help id={`${id}-desc`} error={error} hint={hint} />
    </div>
  );
}

/** Number with −/+ buttons. Typing is free; the value is clamped when leaving the field. */
export function Stepper({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
  error,
  suffix,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
  error?: string;
  suffix?: string;
}) {
  const w = getMessages().wizard;
  const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    onChange(raw.trim() === "" || !Number.isFinite(n) ? value : clamp(n));
    setText(null);
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${w.minus} : ${label}`}
          aria-controls={id}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
          className={`grid size-12 shrink-0 place-items-center rounded-[var(--radius)] border-2 border-ink text-2xl font-black hover:bg-surface-2 ${DISABLED_BORDERED}`}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={text ?? String(value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${id}-desc` : undefined}
          onFocus={() => setText(String(value))}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
          className="display h-12 w-24 rounded-[var(--radius)] border-2 border-line bg-surface text-center text-3xl tabular text-ink focus:border-accent aria-[invalid]:border-danger"
        />
        <button
          type="button"
          aria-label={`${w.plus} : ${label}`}
          aria-controls={id}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
          className={`grid size-12 shrink-0 place-items-center rounded-[var(--radius)] border-2 border-ink text-2xl font-black hover:bg-surface-2 ${DISABLED_BORDERED}`}
        >
          +
        </button>
        {suffix && <span className="text-ink-soft">{suffix}</span>}
      </div>
      <Help id={`${id}-desc`} error={error} hint={hint} />
    </div>
  );
}

/** On/off switch built on a native checkbox. */
export function Toggle({
  label,
  text,
  checked,
  onChange,
}: {
  label: string;
  text?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-4 rounded-[var(--radius)] border-2 border-line bg-surface px-4 py-3 hover:border-ink-soft">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-bold">{label}</span>
        {text && <span className="text-sm text-ink-soft">{text}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-8 w-14 shrink-0 rounded-full bg-surface-2 ring-2 ring-line transition peer-checked:bg-accent peer-checked:ring-accent peer-focus-visible:outline-solid peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:left-1 after:top-1 after:size-6 after:rounded-full after:bg-surface after:transition peer-checked:after:translate-x-6"
      />
    </label>
  );
}

export type Option<T extends string> = { value: T; label: string; text?: string; icon?: string };

/** One choice among a few: a row of large chips (native radio buttons). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  hint,
  wide = false,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  error?: string;
  hint?: ReactNode;
  /** One option per line, with its explanation. */
  wide?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="grid gap-2" aria-describedby={hint || error ? `${name}-desc` : undefined}>
      <legend className="mb-1.5 text-sm font-bold">{label}</legend>
      <div className={cn(wide ? "grid gap-2" : "flex flex-wrap gap-2")}>
        {options.map((o) => (
          <label key={o.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-[var(--radius)] border-2 border-line bg-surface px-4 py-2 font-bold transition hover:border-ink-soft",
                "peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-solid peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
                wide && "items-start py-3",
              )}
            >
              {o.icon && <Icon name={o.icon} size={20} className="shrink-0" />}
              <span className="grid gap-0.5">
                <span>{o.label}</span>
                {o.text && <span className="text-sm font-normal text-ink-soft">{o.text}</span>}
              </span>
            </span>
          </label>
        ))}
      </div>
      <Help id={`${name}-desc`} error={error} hint={hint} />
    </fieldset>
  );
}
