import { clsx } from "clsx";
import type { SellerType } from "@/types";

export type BadgeTone = "slate" | "green" | "amber" | "blue" | "red";

const toneClasses: Record<BadgeTone, string> = {
  slate:
    "border-[var(--line-strong)] bg-[var(--surface-muted)] text-[var(--ink-soft)]",
  green:
    "border-[oklch(0.38_0.05_145)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
  amber:
    "border-[oklch(0.4_0.07_80)] bg-[oklch(0.23_0.035_80)] text-[var(--status-warning)]",
  blue:
    "border-[oklch(0.39_0.045_225)] bg-[oklch(0.23_0.025_225)] text-[oklch(0.76_0.07_225)]",
  red:
    "border-[oklch(0.4_0.07_24)] bg-[oklch(0.23_0.035_24)] text-[var(--status-error)]",
};

export function Badge({
  children,
  tone = "slate",
}: Readonly<{
  children: React.ReactNode;
  tone?: BadgeTone;
}>) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function getSellerTypeTone(sellerType: SellerType): BadgeTone {
  switch (sellerType) {
    case "private":
      return "green";
    case "agency":
      return "blue";
    default:
      return "amber";
  }
}

export function getStatusTone(status: string): BadgeTone {
  switch (status) {
    case "new":
      return "green";
    case "review":
      return "amber";
    case "contacted":
    case "negotiating":
      return "blue";
    case "archived":
      return "red";
    default:
      return "slate";
  }
}
