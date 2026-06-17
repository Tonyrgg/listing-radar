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
  const progress = Math.max(0, Math.min(100, breakdown.total));

  return (
    <div className="w-full rounded-[8px] border border-[var(--line-soft)] bg-[color-mix(in_oklch,var(--surface-muted)_82%,var(--surface-accent-soft))] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]">
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-subtle)]">
        Appetibilita
      </p>
      <div className="mt-2 flex items-end justify-center gap-2">
        <strong className="text-[32px] font-semibold leading-none tabular-nums text-[var(--ink-strong)]">
          {breakdown.total}
        </strong>
        <span className="pb-1 text-xs font-semibold text-[var(--ink-soft)]">
          pt
        </span>
        <span className="mb-1 rounded-full border border-[color-mix(in_oklch,var(--surface-accent)_35%,transparent)] bg-[var(--surface-accent-soft)] px-2 py-1 text-[10px] font-bold leading-none text-[var(--surface-accent)]">
          {level}
        </span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.17_26)_0%,oklch(0.62_0.17_26)_33%,oklch(0.78_0.14_82)_33%,oklch(0.78_0.14_82)_66%,var(--surface-accent)_66%,var(--surface-accent)_100%)]">
        <span
          className="absolute top-0 h-full w-1 rounded-full bg-[var(--ink-strong)] shadow-[0_0_0_1px_var(--surface-canvas)]"
          style={{ left: `calc(${progress}% - 2px)` }}
        />
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
