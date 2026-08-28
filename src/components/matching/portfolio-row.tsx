import type { ReactNode } from "react";

import { DatoAssente } from "@/components/ui/atoms";
import { RowAction, RowLink, Stripe, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatNumber, formatShouty } from "@/lib/formatting";
import { cleanPropertyTitle } from "@/lib/matching/request-presentation";
import type { PortfolioProperty } from "@/lib/matching/types";

/**
 * Una casa che abbiamo in mano, in una riga.
 *
 * Prima ogni immobile era due tabelle affiancate di cinque righe ciascuna, e
 * la maggior parte diceva «Non indicato»: dieci righe per scoprire che di
 * quella casa sappiamo il prezzo e poco altro. Il portafoglio ha le foto —
 * `image_urls` — e non ne mostrava nemmeno una.
 */

export function prezzoDelContratto(property: PortfolioProperty) {
  if (property.contract_type === "rent") {
    return property.monthly_rent != null
      ? `${formatCurrency(property.monthly_rent)} al mese`
      : null;
  }

  return property.price != null ? formatCurrency(property.price) : null;
}

export function PortfolioRow({
  property,
  href,
  tono = "neutral",
  coda,
}: Readonly<{
  property: PortfolioProperty;
  href?: string;
  tono?: Tone;
  /** Quello che questa pagina ha da dire su questa casa, a destra. */
  coda?: ReactNode;
}>) {
  const foto = property.image_urls?.[0];
  const dove = property.zone?.name ?? property.municipality ?? null;
  const superficie = property.internal_sqm ?? property.commercial_sqm;
  const prezzo = prezzoDelContratto(property);
  const nome = formatShouty(property.address ?? cleanPropertyTitle(property.title));

  return (
    <article className="group relative flex items-stretch gap-3 border-t border-[var(--lr-line-quiet)] p-3 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]">
      {href ? (
        <RowLink href={href} label={`Apri ${nome}`} />
      ) : null}
      <Stripe tone={tono} />

      <span className="relative z-10 block h-20 w-28 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]">
        {foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : null}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p className="text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {property.contract_type === "rent" ? "In affitto" : "In vendita"}
          {dove ? ` · ${dove}` : ""}
        </p>

        <h3 className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug text-[var(--lr-ink)]">
          {nome}
        </h3>

        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          {prezzo ? (
            <b className="font-[650] text-[var(--lr-ink)]">{prezzo}</b>
          ) : (
            <DatoAssente label="prezzo non indicato" />
          )}
          {superficie != null ? <span>{formatNumber(superficie)} mq</span> : null}
          {property.rooms != null ? <span>{formatNumber(property.rooms)} locali</span> : null}
          {property.floor != null ? (
            <span>{property.floor === 0 ? "piano terra" : `piano ${formatNumber(property.floor)}`}</span>
          ) : null}
        </p>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-end justify-center gap-2">
        {coda}
        {href ? <RowAction /> : null}
      </div>
    </article>
  );
}
