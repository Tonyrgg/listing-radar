import { clsx } from "clsx";
import type { SellerType } from "@/types";

export type BadgeTone = "slate" | "green" | "amber" | "blue" | "red";

const toneClasses: Record<BadgeTone, string> = {
  slate:
    "border-[color:color-mix(in_srgb,var(--line-strong)_65%,transparent)] bg-[var(--surface-muted)] text-[var(--ink-soft)]",
  green:
    "border-[color:color-mix(in_srgb,var(--surface-accent)_30%,white)] bg-[var(--surface-accent-soft)] text-[var(--surface-accent)]",
  amber:
    "border-[color:oklch(0.86_0.05_85)] bg-[oklch(0.95_0.03_85)] text-[oklch(0.46_0.06_85)]",
  blue:
    "border-[color:oklch(0.85_0.03_230)] bg-[oklch(0.95_0.02_230)] text-[oklch(0.42_0.03_230)]",
  red:
    "border-[color:oklch(0.86_0.04_22)] bg-[oklch(0.95_0.02_22)] text-[oklch(0.5_0.05_22)]",
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
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
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
