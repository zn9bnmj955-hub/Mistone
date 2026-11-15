import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { DISABLED_BORDERED, DISABLED_PLAIN } from "./disabled";

type Variant = "primary" | "inverse" | "outline" | "ghost" | "danger";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-105 active:brightness-95",
  inverse: "bg-inverse text-on-inverse hover:opacity-90",
  outline: "border-2 border-ink text-ink hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-on-status hover:brightness-105",
};
const SIZES: Record<Size, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-bold transition",
    variant === "outline" ? DISABLED_BORDERED : DISABLED_PLAIN,
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

type Common = { variant?: Variant; size?: Size; children: ReactNode; className?: string };

export function Button({ variant, size, className, ...props }: Common & ComponentProps<"button">) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: Common & ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
