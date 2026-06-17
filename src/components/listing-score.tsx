import {
  getPriorityScoreBreakdown,
  getPriorityScoreLevel,
} from "@/lib/listings/scoring";
import { ListingScorePopover } from "@/components/listing-score-popover";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
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
  scoringConfig,
}: Readonly<{ listing: ScoreListing; scoringConfig?: ScoringConfig }>) {
  const breakdown = getPriorityScoreBreakdown(scoreInput(listing), scoringConfig);
  const level = getPriorityScoreLevel(breakdown.total, scoringConfig);
  const progress = Math.max(0, Math.min(100, breakdown.total));

  return (
    <ListingScorePopover
      total={breakdown.total}
      level={level}
      progress={progress}
      awarded={breakdown.awarded}
      deductions={breakdown.deductions}
    />
  );
}

export function ListingScoreBreakdown({
  listing,
  scoringConfig,
}: Readonly<{ listing: ScoreListing; scoringConfig?: ScoringConfig }>) {
  const breakdown = getPriorityScoreBreakdown(scoreInput(listing), scoringConfig);

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
            {getPriorityScoreLevel(breakdown.total, scoringConfig)}
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
