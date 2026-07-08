import { createHash } from "node:crypto";

import { createDerivedListingValues, getHighPriorityThreshold, isHotOldListing } from "@/lib/listings/scoring";
import { generateReport } from "@/lib/reports/generate-report";
import { mockProvider } from "@/lib/scrapers/providers/mock";
import type { Listing, ListingSource, ListingSnapshot, Report } from "@/types";

function hashDescription(value: string | null | undefined) {
  return createHash("sha1").update(value ?? "").digest("hex");
}

function buildSnapshots(listing: Listing, previousPrice: number | null | undefined) {
  const snapshots: ListingSnapshot[] = [];

  if (previousPrice != null) {
    snapshots.push({
      id: `${listing.id}-snapshot-1`,
      listingId: listing.id,
      checkedAt: new Date(Date.parse(listing.lastSeenAt) - 1000 * 60 * 60 * 24 * 7).toISOString(),
      source: listing.source,
      url: listing.url,
      price: previousPrice,
      title: listing.title,
      descriptionHash: hashDescription(listing.description),
      isAvailable: true,
      latitude: listing.latitude,
      longitude: listing.longitude,
      coordinatesSource: listing.coordinatesSource,
      rawPayload: { version: "previous", previousPrice },
      createdAt: new Date(Date.parse(listing.lastSeenAt) - 1000 * 60 * 60 * 24 * 7).toISOString(),
    });
  }

  snapshots.push({
    id: `${listing.id}-snapshot-2`,
    listingId: listing.id,
    checkedAt: listing.lastSeenAt,
    source: listing.source,
    url: listing.url,
    price: listing.price,
    title: listing.title,
    descriptionHash: hashDescription(listing.description),
    isAvailable: true,
    latitude: listing.latitude,
    longitude: listing.longitude,
    coordinatesSource: listing.coordinatesSource,
    rawPayload: { version: "current" },
    createdAt: listing.lastSeenAt,
  });

  return snapshots;
}

function buildSources(listing: Listing) {
  const primarySource: ListingSource = {
    id: `${listing.id}-source-1`,
    listingId: listing.id,
    source: listing.source,
    url: listing.url,
    sourceListingId: listing.sourceListingId,
    sellerName: listing.sellerName,
    firstSeenAt: listing.firstSeenAt,
    lastSeenAt: listing.lastSeenAt,
    createdAt: listing.firstSeenAt,
  };

  return [primarySource];
}

export async function getMockListings() {
  const normalizedListings = await mockProvider.fetchListings();

  return normalizedListings
    .map((normalized) => {
      const derived = createDerivedListingValues(normalized);
      const firstSeenAt = normalized.firstSeenAt ?? new Date().toISOString();
      const lastSeenAt = normalized.lastSeenAt ?? normalized.checkedAt ?? new Date().toISOString();

      const listing: Listing = {
        id: normalized.id ?? crypto.randomUUID(),
        source: normalized.source,
        sourceListingId: normalized.sourceListingId ?? null,
        url: normalized.url,
        canonicalUrl: normalized.canonicalUrl ?? normalized.url,
        title: normalized.title,
        description: normalized.description ?? null,
        price: normalized.price ?? null,
        sqm: normalized.sqm ?? null,
        pricePerSqm: derived.pricePerSqm,
        rooms: normalized.rooms ?? null,
        floor: normalized.floor ?? null,
        zone: normalized.zone ?? null,
        addressRaw: normalized.addressRaw ?? null,
        latitude: normalized.latitude ?? null,
        longitude: normalized.longitude ?? null,
        coordinatesSource: normalized.coordinatesSource ?? null,
        sellerType: normalized.sellerType,
        sellerName: normalized.sellerName ?? null,
        phone: normalized.phone ?? null,
        imageUrls: normalized.imageUrls ?? [],
        portalDeclaredDate: normalized.portalDeclaredDate ?? null,
        metadataDatePublished: normalized.metadataDatePublished ?? null,
        metadataDateModified: normalized.metadataDateModified ?? null,
        firstSeenAt,
        lastSeenAt,
        status: normalized.status ?? "new",
        crmStatus: "untreated",
        priorityScore: derived.priorityScore,
        sellerFatigueScore: derived.sellerFatigueScore,
        duplicateGroupId: null,
        isPriceDropped: derived.isPriceDropped,
        isNewToday: derived.isNewToday,
        createdAt: firstSeenAt,
        updatedAt: lastSeenAt,
        minimumDaysOnline: derived.minimumDaysOnline,
        note: normalized.note ?? null,
        suspectedRepublished: normalized.isRepublishedSuspected ?? false,
      };

      listing.snapshots = buildSnapshots(listing, normalized.previousPrice);
      listing.sources = buildSources(listing);

      return listing;
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);
}

export async function getMockListingById(id: string) {
  const listings = await getMockListings();
  return listings.find((listing) => listing.id === id) ?? null;
}

export async function getMockReports() {
  const listings = await getMockListings();
  const reportDates = [0, 1, 2].map((offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date;
  });

  const reportInputs = [
    listings,
    listings.filter((listing) => listing.minimumDaysOnline >= 10),
    listings.filter((listing) => listing.priorityScore >= getHighPriorityThreshold() || listing.isPriceDropped),
  ];

  return reportInputs.map((currentListings, index) => {
    const reportBody = generateReport(currentListings, reportDates[index]);

    const report: Report = {
      id: `report-${index + 1}`,
      reportDate: reportBody.reportDate,
      totalFound: reportBody.totalFound,
      newCount: reportBody.newCount,
      privateCount: reportBody.privateCount,
      agencyCount: reportBody.agencyCount,
      unknownCount: reportBody.unknownCount,
      priceDropsCount: reportBody.priceDropsCount,
      hotOldCount: reportBody.hotOldCount,
      content: reportBody.content,
      createdAt: reportDates[index].toISOString(),
    };

    return report;
  });
}

export async function getMockDashboardSummary() {
  const listings = await getMockListings();

  return {
    newToday: listings.filter((listing) => listing.isNewToday).length,
    probablePrivate: listings.filter((listing) => listing.sellerType === "private").length,
    agencies: listings.filter((listing) => listing.sellerType === "agency").length,
    toVerify: listings.filter((listing) =>
      ["new", "review"].includes(listing.status),
    ).length,
    priceDrops: listings.filter((listing) => listing.isPriceDropped).length,
    hotOld: listings.filter(isHotOldListing).length,
    highPriority: listings.filter((listing) => listing.priorityScore >= getHighPriorityThreshold()).length,
    watchlist: listings.slice(0, 5),
  };
}
