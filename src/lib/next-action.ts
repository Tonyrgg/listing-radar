import type { IncomingListing, Listing } from "@/types";

/**
 * La prossima azione consigliata.
 *
 * L'idea esisteva già nella Panoramica commerciale, ma viveva tre livelli sotto
 * il menu. Qui diventa l'ingresso del prodotto: una frase che dice cosa fare,
 * il motivo per cui conta e un solo bottone.
 */
export type NextAction = {
  title: string;
  reason: string;
  href: string;
  actionLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

function daysSince(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function getNextAction({
  pendingListings,
  pendingCount,
  opportunities,
  lastEmailCheckAt,
  emailEnabled,
  lastRunHadErrors,
}: {
  pendingListings: IncomingListing[];
  pendingCount: number;
  opportunities: Listing[];
  lastEmailCheckAt: string | null;
  emailEnabled: boolean;
  lastRunHadErrors: boolean;
}): NextAction {
  if (!emailEnabled) {
    return {
      title: "Collega la casella email",
      reason:
        "Le segnalazioni dei portali arrivano per email. Finché la casella non è collegata, la coda resta vuota anche quando il mercato si muove.",
      href: "/settings",
      actionLabel: "Vai alle impostazioni",
    };
  }

  if (lastRunHadErrors) {
    return {
      title: "Controlla l'ultimo giro delle fonti",
      reason:
        "L'ultimo controllo automatico ha segnalato problemi: alcuni siti potrebbero non essere stati letti. Nessun annuncio è stato dichiarato sparito per questo.",
      href: "/settings",
      actionLabel: "Vedi cosa è andato storto",
    };
  }

  if (pendingCount > 0) {
    const oldest = pendingListings.reduce<number>((max, listing) => {
      const age = daysSince(listing.emailReceivedAt ?? listing.createdAt);
      return age > max ? age : max;
    }, 0);

    return {
      title: `Completa ${pendingCount} ${plural(pendingCount, "annuncio arrivato", "annunci arrivati")} per email`,
      reason:
        oldest >= 2
          ? `Sono segnalazioni parziali: mancano metratura e recapito. Il più vecchio aspetta da ${oldest} giorni.`
          : "Sono segnalazioni parziali: mancano metratura e recapito. Aprile sul portale e completa la scheda.",
      href: "/incoming",
      actionLabel: pendingCount > 1 ? "Comincia dai più vecchi" : "Apri l'annuncio",
    };
  }

  if (opportunities.length > 0) {
    const first = opportunities[0];
    return {
      title: `Valuta ${opportunities.length} ${plural(opportunities.length, "occasione", "occasioni")} in evidenza`,
      reason: first?.isPriceDropped
        ? "Almeno una ha appena abbassato il prezzo: è il momento in cui il venditore è più disponibile a trattare."
        : "La coda è vuota: è il momento buono per guardare le schede che meritano una telefonata.",
      href: "/listings?onlyHighPriority=on&sortBy=score_desc",
      actionLabel: "Apri le occasioni",
      secondaryHref: "/lifecycle/opportunities",
      secondaryLabel: "Vedi i segnali",
    };
  }

  return {
    title: "Hai completato tutta la coda",
    reason: lastEmailCheckAt
      ? `Ultimo controllo delle email ${new Intl.DateTimeFormat("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(lastEmailCheckAt))}. Il prossimo parte da solo.`
      : "Il controllo automatico parte da solo. Nel frattempo puoi guardare i segnali del mercato.",
    href: "/lifecycle",
    actionLabel: "Guarda i segnali",
    secondaryHref: "/listings",
    secondaryLabel: "Sfoglia l'archivio",
  };
}
