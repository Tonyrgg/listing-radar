import { clsx } from "clsx";
import type { SellerType } from "@/types";

export type BadgeTone = "slate" | "green" | "amber" | "blue" | "red";

const toneClasses: Record<BadgeTone, string> = {
  slate:
    "border-[var(--line-soft)] bg-[var(--surface-muted)] text-[var(--ink-soft)]",
  green:
    "border-[oklch(0.44_0.07_150)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
  amber:
    "border-[oklch(0.42_0.07_80)] bg-[oklch(0.235_0.035_80)] text-[var(--status-warning)]",
  blue:
    "border-[oklch(0.42_0.045_230)] bg-[oklch(0.235_0.025_230)] text-[oklch(0.76_0.06_230)]",
  red:
    "border-[oklch(0.42_0.07_28)] bg-[oklch(0.235_0.035_28)] text-[var(--status-error)]",
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
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em]",
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
