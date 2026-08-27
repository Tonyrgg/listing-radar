import type { ReactNode } from "react";
import type { SellerType } from "@/types";

import { Chip, type Tone } from "@/components/ui/primitives";

/**
 * Nome storico conservato per non riscrivere ogni chiamata,
 * ma il disegno e i toni sono quelli del chip unico.
 */
export type BadgeTone = "slate" | "green" | "amber" | "blue" | "red";

const toneMap: Record<BadgeTone, Tone> = {
  slate: "neutral",
  /* «Verde» ha sempre voluto dire «va tutto bene»: e uno stato, non un'azione. */
  green: "ok",
  amber: "warn",
  blue: "info",
  red: "danger",
};

export function Badge({
  children,
  tone = "slate",
}: Readonly<{
  children: ReactNode;
  tone?: BadgeTone;
}>) {
  return (
    <Chip tone={toneMap[tone]} dot={tone !== "slate"}>
      {children}
    </Chip>
  );
}

export function getSellerTypeTone(sellerType: SellerType): BadgeTone {
  switch (sellerType) {
    case "private":
      return "blue";
    case "agency":
      return "slate";
    default:
      return "amber";
  }
}

export function getStatusTone(status: string): BadgeTone {
  switch (status) {
    case "new":
      return "blue";
    case "review":
      return "amber";
    case "contacted":
    case "negotiating":
      return "slate";
    case "archived":
      return "red";
    default:
      return "slate";
  }
}
