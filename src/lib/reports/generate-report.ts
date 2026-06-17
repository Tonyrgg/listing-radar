import {
  getHighPriorityThreshold,
  getHighPriorityThresholdFromConfig,
  isHotOldListing,
  isHotOldListingWithConfig,
} from "@/lib/listings/scoring";
import { toIsoDate } from "@/lib/formatting";
import type { ScoringConfig } from "@/lib/listings/scoring-config";
import type { Listing, Report } from "@/types";

export function generateReport(
  listings: Listing[],
  reportDate = new Date(),
  scoringConfig?: ScoringConfig,
): Omit<Report, "id" | "createdAt"> {
  const sortedTopListings = [...listings]
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 5);

  const totalFound = listings.length;
  const newCount = listings.filter((listing) => listing.isNewToday).length;
  const privateCount = listings.filter((listing) => listing.sellerType === "private").length;
  const agencyCount = listings.filter((listing) => listing.sellerType === "agency").length;
  const unknownCount = listings.filter((listing) => listing.sellerType === "unknown").length;
  const priceDropsCount = listings.filter((listing) => listing.isPriceDropped).length;
  const hotOldCount = scoringConfig
    ? listings.filter((listing) =>
        isHotOldListingWithConfig(listing, scoringConfig),
      ).length
    : listings.filter(isHotOldListing).length;
  const highPriorityThreshold = scoringConfig
    ? getHighPriorityThresholdFromConfig(scoringConfig)
    : getHighPriorityThreshold();
  const highPriorityCount = listings.filter(
    (listing) => listing.priorityScore >= highPriorityThreshold,
  ).length;

  const lines = [
    `Report ${toIsoDate(reportDate)} - Listing Radar Bitonto`,
    `Totale annunci: ${totalFound}`,
    `Nuovi annunci: ${newCount}`,
    `Privati: ${privateCount}`,
    `Agenzie: ${agencyCount}`,
    `Unknown: ${unknownCount}`,
    `Ribassi: ${priceDropsCount}`,
    `Vecchi caldi: ${hotOldCount}`,
    `Priorita alta: ${highPriorityCount}`,
    "",
    "Top 5 priorita alta:",
    ...sortedTopListings.map(
      (listing, index) =>
        `${index + 1}. ${listing.title} | score ${listing.priorityScore} | ${listing.source} | ${listing.zone ?? "zona n/d"}`,
    ),
  ];

  return {
    reportDate: toIsoDate(reportDate),
    totalFound,
    newCount,
    privateCount,
    agencyCount,
    unknownCount,
    priceDropsCount,
    hotOldCount,
    content: lines.join("\n"),
  };
}
