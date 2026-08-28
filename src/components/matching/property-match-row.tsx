import { AlertTriangle, Check } from "lucide-react";

import { RowAction, RowLink, Stripe, type Tone } from "@/components/ui/primitives";
import { formatCurrency, formatNumber, formatShouty } from "@/lib/formatting";
import { cleanPropertyTitle } from "@/lib/matching/request-presentation";
import type { PortfolioProperty, RequestPropertyMatch } from "@/lib/matching/types";

/**
 * Una casa che potrebbe andare bene a un cliente.
 *
 * Prima ogni riga apriva con «100% COMPATIBILE» in grande: una percentuale che
 * per essere letta va prima capita, e che comunque non cambia quello che fai.
 * Conta la casa — la foto, dove sta, quanto costa — e due parole sul perché è
 * lì. La percentuale resta, ma nel titolo del cursore: serve a chi la cerca.
 */

/* Il verdetto è un giudizio, non un comando: la parola porta la scala e il
 * punto la conferma. L'accento resta all'azione, che qui è aprire la scheda. */
const VERDETTO: Record<string, { parola: string; tono: Tone; forte?: boolean }> = {
  compatible: { parola: "Va bene", tono: "ok", forte: true },
  almost_compatible: { parola: "Ci va vicino", tono: "info" },
  weak: { parola: "Da valutare", tono: "neutral" },
  not_relevant: { parola: "Poco pertinente", tono: "neutral" },
};

const COLORE: Record<Tone, string> = {
  action: "text-[var(--lr-accent)]",
  ok: "text-[var(--lr-ok)]",
  info: "text-[var(--lr-info)]",
  warn: "text-[var(--lr-warn)]",
  danger: "text-[var(--lr-danger)]",
  neutral: "text-[var(--lr-ink-3)]",
};

function prezzo(property: PortfolioProperty) {
  if (property.contract_type === "rent") {
    return property.monthly_rent != null
      ? `${formatCurrency(property.monthly_rent)} al mese`
      : "Canone non indicato";
  }

  return formatCurrency(property.price);
}

export function PropertyMatchRow({
  match,
  property,
}: Readonly<{ match: RequestPropertyMatch; property: PortfolioProperty }>) {
  const verdetto = VERDETTO[match.classification] ?? VERDETTO.weak;
  const foto = property.image_urls?.[0];
  const dove = property.zone?.name ?? property.municipality ?? null;
  const superficie = property.internal_sqm ?? property.commercial_sqm;

  return (
    <article className="group relative flex items-stretch gap-3 border-t border-[var(--lr-line-quiet)] p-3 transition-colors first:border-t-0 hover:bg-[var(--lr-raised)]">
      {match.id ? (
        <RowLink
          href={`/matching/${match.id}`}
          label={`Analizza ${property.title}`}
        />
      ) : null}
      <Stripe tone={verdetto.tono} />

      <span className="relative z-10 block h-20 w-28 shrink-0 overflow-hidden rounded-[var(--lr-radius-control)] bg-[var(--lr-raised)]">
        {foto ? (
          <span
            className="block size-full bg-cover bg-center"
            style={{ backgroundImage: `url("${foto}")` }}
          />
        ) : null}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1">
        <h4 className="truncate text-[length:var(--lr-text-record)] font-[650] leading-snug text-[var(--lr-ink)]">
          {formatShouty(property.address ?? cleanPropertyTitle(property.title))}
        </h4>

        <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
          <b className="font-[650] text-[var(--lr-ink)]">{prezzo(property)}</b>
          {superficie != null ? <span>{formatNumber(superficie)} mq</span> : null}
          {property.rooms != null ? <span>{formatNumber(property.rooms)} locali</span> : null}
          {dove ? <span>{dove}</span> : null}
        </p>

        {/* Cosa torna e cosa no: segni, non etichette. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--lr-text-meta)] text-[var(--lr-ink-3)]">
          {match.matched_criteria.slice(0, 4).map((criterio) => (
            <span key={criterio} className="inline-flex items-center gap-1">
              <Check aria-hidden="true" className="size-3.5 text-[var(--lr-ink-3)]" />
              {criterio}
            </span>
          ))}
          {match.conflicting_criteria.slice(0, 2).map((criterio) => (
            <span key={criterio} className="inline-flex items-center gap-1 text-[var(--lr-warn)]">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              {criterio}
            </span>
          ))}
        </p>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-end justify-center gap-2">
        <span
          className={`text-[length:var(--lr-text-record)] font-[650] ${verdetto.forte ? "text-[var(--lr-ink)]" : COLORE[verdetto.tono]}`}
          title={`Affinità calcolata: ${Math.round(match.score)} su 100`}
        >
          {verdetto.parola}
        </span>
        {match.id ? <RowAction label="Analizza" /> : null}
      </div>
    </article>
  );
}
