import {
  getPriorityScoreBreakdown,
  getPriorityScoreLevel,
} from "@/lib/listings/scoring";
import type { Listing } from "@/types";

type ScoreListing = Pick<
  Listing,
  | "sellerType"
  | "isNewToday"
  | "phone"
  | "minimumDaysOnline"
  | "isPriceDropped"
  | "description"
  | "price"
  | "sqm"
>;

function scoreInput(listing: ScoreListing) {
  return {
    sellerType: listing.sellerType,
    isNewToday: listing.isNewToday,
    hasPhone: Boolean(listing.phone),
    minimumDaysOnline: listing.minimumDaysOnline,
    isPriceDropped: listing.isPriceDropped,
    description: listing.description,
    price: listing.price,
    sqm: listing.sqm,
  };
}

export function ListingScoreSummary({
  listing,
}: Readonly<{ listing: ScoreListing }>) {
  const breakdown = getPriorityScoreBreakdown(scoreInput(listing));
  const level = getPriorityScoreLevel(breakdown.total);

  return (
    <div className="grid w-full gap-2 rounded-[7px] border border-[color-mix(in_oklch,var(--surface-accent)_24%,var(--line-soft))] bg-[linear-gradient(135deg,color-mix(in_oklch,var(--surface-accent)_10%,var(--surface-muted)),var(--surface-muted))] p-2.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-subtle)]">
          Indice
        </span>
        <span className="rounded-full bg-[var(--surface-accent-soft)] px-2 py-1 text-[10px] font-bold leading-none text-[var(--surface-accent)]">
          {level}
        </span>
      </div>
      <div className="flex items-end gap-1">
        <strong className="text-2xl font-semibold leading-none tabular-nums text-[var(--ink-strong)]">
          {breakdown.total}
        </strong>
        <span className="pb-0.5 text-[11px] font-semibold text-[var(--ink-soft)]">
          pt
        </span>
      </div>
    </div>
  );
}

export function ListingScoreBreakdown({
  listing,
}: Readonly<{ listing: ScoreListing }>) {
  const breakdown = getPriorityScoreBreakdown(scoreInput(listing));

  return (
    <section className="border-y border-[var(--line-soft)] py-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-subtle)]">
            Indice di appetibilita
          </p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Quanto conviene controllare questo immobile prima degli altri.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-semibold tabular-nums text-[var(--ink-strong)]">
            {breakdown.total}
          </p>
          <p className="text-xs font-semibold text-[var(--surface-accent)]">
            {getPriorityScoreLevel(breakdown.total)}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {breakdown.awarded.length ? (
          breakdown.awarded.map((factor) => (
            <div
              key={factor.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
            >
              <div>
                <p className="text-sm font-medium text-[var(--ink-strong)]">
                  {factor.label}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--ink-subtle)]">
                  {factor.explanation}
                </p>
              </div>
              <strong className="text-sm tabular-nums text-[var(--surface-accent)]">
                +{factor.points}
              </strong>
            </div>
          ))
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">
            Nessun criterio di appetibilita e stato ancora rilevato.
          </p>
        )}
      </div>

      <details className="mt-5 border-t border-[var(--line-soft)] pt-4">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)]">
          Vedi criteri non maturati ({breakdown.notAwarded.length})
        </summary>
        <div className="mt-3 space-y-2">
          {breakdown.notAwarded.map((factor) => (
            <div
              key={factor.id}
              className="flex items-start justify-between gap-3 text-xs text-[var(--ink-subtle)]"
            >
              <span>{factor.label}</span>
              <span className="shrink-0">
                0 / {factor.points > 0 ? `+${factor.points}` : factor.points}
              </span>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-4 text-xs leading-5 text-[var(--ink-subtle)]">
        <div className="min-w-0">
          {breakdown.deductions.length ? (
            <div className="space-y-2">
              {breakdown.deductions.map((factor) => (
                <div
                  key={factor.id}
                  className="flex items-start justify-between gap-3"
                >
                  <span>{factor.label}</span>
                  <strong className="shrink-0 tabular-nums text-[var(--status-error)]">
                    {factor.points}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            "Nessuna detrazione: il modello attuale assegna punti, ma non ne sottrae."
          )}
        </div>
      </div>
    </section>
  );
}
