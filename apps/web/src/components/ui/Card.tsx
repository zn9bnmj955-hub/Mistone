import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-lg)] border border-line bg-surface p-4 card-depth", className)} {...props} />;
}
