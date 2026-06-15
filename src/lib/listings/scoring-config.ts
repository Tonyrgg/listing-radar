function numberValue(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getScoringConfig() {
  return {
    privateSeller: numberValue("SCORE_PRIVATE_SELLER", 40),
    agencySeller: numberValue("SCORE_AGENCY_SELLER", -15),
    unknownSeller: numberValue("SCORE_UNKNOWN_SELLER", -5),
    newToday: numberValue("SCORE_NEW_TODAY", 25),
    visiblePhone: numberValue("SCORE_VISIBLE_PHONE", 20),
    online60Days: numberValue("SCORE_ONLINE_60_DAYS", 20),
    online120Days: numberValue("SCORE_ONLINE_120_DAYS", 35),
    priceDrop: numberValue("SCORE_PRICE_DROP", 20),
    negotiablePrice: numberValue("SCORE_NEGOTIABLE_PRICE", 10),
    noAgencies: numberValue("SCORE_NO_AGENCIES", 10),
    missingPrice: numberValue("SCORE_MISSING_PRICE", -20),
    missingSqm: numberValue("SCORE_MISSING_SQM", -10),
    missingDescription: numberValue("SCORE_MISSING_DESCRIPTION", -5),
    auction: numberValue("SCORE_AUCTION", -30),
    highPriorityThreshold: numberValue("SCORE_HIGH_PRIORITY_THRESHOLD", 80),
  };
}
