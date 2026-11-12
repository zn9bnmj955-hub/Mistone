"use client";
import type { ReactNode } from "react";
import { Icon } from "@orgasport/ui";
import { cn } from "./cn";

/** Large touch card used by the one-question-per-screen onboarding. */
export function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  text,
  multiple = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: string;
  title: ReactNode;
  text?: ReactNode;
  multiple?: boolean;
}) {
  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group flex min-h-20 w-full items-center gap-4 rounded-[var(--radius-lg)] border-2 p-4 text-left card-lift",
        selected ? "border-accent bg-accent-soft" : "border-line bg-surface",
      )}
    >
      {icon && (
        <span
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-full border-2 transition",
            selected ? "border-accent bg-accent text-on-accent" : "border-line text-ink",
          )}
        >
          <Icon name={icon} size={24} />
        </span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="display text-2xl">{title}</span>
        {text && <span className="text-sm text-ink-soft">{text}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center border-2 transition",
          multiple ? "rounded-md" : "rounded-full",
          selected ? "border-accent bg-accent text-on-accent" : "border-line text-transparent",
        )}
      >
        <Icon name="check" size={16} strokeWidth={3} />
      </span>
    </button>
  );
}
