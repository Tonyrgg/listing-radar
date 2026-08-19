export interface PriceChange {
  eventType: "PRICE_DROP" | "PRICE_INCREASE" | "PRICE_CHANGED";
  oldPrice: number | null;
  newPrice: number | null;
  absoluteDelta: number | null;
  percentageDelta: number | null;
}

export function classifyPriceChange(
  oldPrice: number | null,
  newPrice: number | null,
): PriceChange | null {
  if (oldPrice === newPrice) {
    return null;
  }
  if (oldPrice == null || newPrice == null) {
    return {
      eventType: "PRICE_CHANGED",
      oldPrice,
      newPrice,
      absoluteDelta: null,
      percentageDelta: null,
    };
  }

  const signedDelta = newPrice - oldPrice;
  return {
    eventType: signedDelta < 0 ? "PRICE_DROP" : "PRICE_INCREASE",
    oldPrice,
    newPrice,
    absoluteDelta: Math.abs(signedDelta),
    percentageDelta:
      oldPrice === 0 ? null : Number(((signedDelta / oldPrice) * 100).toFixed(2)),
  };
}
