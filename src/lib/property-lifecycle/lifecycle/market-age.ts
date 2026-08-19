export interface MarketStartRange {
  lowerBound: string | null;
  upperBound: string | null;
  method: string;
  confidence: number;
}

function anchor(range: MarketStartRange): number {
  const value = range.lowerBound ?? range.upperBound;
  return value ? Date.parse(value) : Number.POSITIVE_INFINITY;
}

export function mergeTrueMarketStart(
  existing: MarketStartRange | null,
  observed: MarketStartRange,
): MarketStartRange {
  if (!existing || anchor(observed) < anchor(existing)) {
    return { ...observed };
  }

  return { ...existing };
}

export function trueMarketAgeDays(
  marketStart: MarketStartRange,
  asOf: string,
): { minimumDays: number | null; maximumDays: number | null } {
  const asOfTime = Date.parse(asOf);
  const lowerTime = marketStart.lowerBound ? Date.parse(marketStart.lowerBound) : null;
  const upperTime = marketStart.upperBound ? Date.parse(marketStart.upperBound) : null;
  const day = 86_400_000;

  return {
    minimumDays: upperTime == null ? null : Math.max(0, Math.floor((asOfTime - upperTime) / day)),
    maximumDays: lowerTime == null ? null : Math.max(0, Math.floor((asOfTime - lowerTime) / day)),
  };
}
