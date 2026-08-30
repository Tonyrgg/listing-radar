import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { ingestEmailAlerts } from "@/lib/email-alerts/ingest";
import { upsertListings } from "@/lib/listings/upsert-listings";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { LIFECYCLE_CACHE_TAG } from "@/lib/property-lifecycle/read-models/server";
import { generateReport } from "@/lib/reports/generate-report";
import { getProvidersForRun } from "@/lib/scrapers/providers";
import { getPersistedScoringConfig } from "@/lib/settings/scoring-config-repository";
import type {
  ListingsProvider,
  ProviderRunIssue,
} from "@/lib/scrapers/providers/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Listing, NormalizedListing } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function finalizeRun(
  runId: string,
  payload: {
    status: string;
    total_found?: number;
    total_inserted?: number;
    total_updated?: number;
    error_count?: number;
  },
) {
  const supabase = getSupabaseServiceClient();

  await supabase
    .from("scrape_runs")
    .update({
      ...payload,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

function issueFromError(
  type: ProviderRunIssue["type"],
  message: string,
  error: unknown,
): ProviderRunIssue {
  return {
    type,
    message,
    details:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack ?? null,
          }
        : {
            message: String(error),
          },
  };
}

async function logScrapeIssues(
  runId: string,
  provider: string,
  issues: ProviderRunIssue[],
) {
  if (issues.length === 0) {
    return;
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("scrape_errors").insert(
    issues.map((issue) => ({
      scrape_run_id: runId,
      source: provider,
      message: issue.message,
      details: {
        type: issue.type,
        url: issue.url ?? null,
        ...(issue.details ?? {}),
      },
    })),
  );

  if (error) {
    console.warn("[cron] unable to persist scrape issues", {
      provider,
      error: error.message,
    });
  }
}

type ProviderCronResult = {
  provider: string;
  ok: boolean;
  totalFound: number;
  inserted: number;
  updated: number;
  snapshots: number;
  searchUrls: string[];
  foundUrls: number;
  detailPagesRead: number;
  errors: ProviderRunIssue[];
  listings: Listing[];
};

async function runProvider(
  provider: ListingsProvider,
  runId: string,
): Promise<ProviderCronResult> {
  let normalizedListings: NormalizedListing[] = [];
  const errors: ProviderRunIssue[] = [];
  let inserted = 0;
  let updated = 0;
  let snapshots = 0;
  let listings: Listing[] = [];

  try {
    normalizedListings = await provider.fetchListings();
  } catch (error) {
    errors.push(
      issueFromError(
        "fetch",
        `Provider ${provider.name} failed before returning listings.`,
        error,
      ),
    );
  }

  const runLog = provider.getLastRunLog?.();
  errors.push(...(runLog?.errors ?? []));

  if (normalizedListings.length > 0) {
    try {
      const upsertResult = await upsertListings(normalizedListings);
      inserted = upsertResult.inserted;
      updated = upsertResult.updated;
      snapshots = upsertResult.snapshots;
      listings = upsertResult.listings;
    } catch (error) {
      errors.push(
        issueFromError(
          "upsert",
          `Unable to persist listings from provider ${provider.name}.`,
          error,
        ),
      );
    }
  }

  const result = {
    provider: provider.name,
    ok: errors.length === 0,
    totalFound: normalizedListings.length,
    inserted,
    updated,
    snapshots,
    searchUrls: runLog?.searchUrls ?? [],
    foundUrls: runLog?.foundUrls ?? normalizedListings.length,
    detailPagesRead: runLog?.detailPagesRead ?? 0,
    errors,
    listings,
  };

  console.info("[cron] provider run completed", {
    provider: result.provider,
    totalFound: result.totalFound,
    inserted: result.inserted,
    updated: result.updated,
    snapshots: result.snapshots,
    searchUrls: result.searchUrls,
    foundUrls: result.foundUrls,
    detailPagesRead: result.detailPagesRead,
    errors: result.errors.length,
  });

  await logScrapeIssues(runId, provider.name, errors);

  return result;
}

function buildProviderReport(results: ProviderCronResult[]) {
  return [
    "",
    "Provider eseguiti:",
    ...results.map(
      (result) =>
        `${result.provider}: ${result.totalFound} annunci, ${result.foundUrls} URL trovati, ${result.detailPagesRead} detail pages lette, ${result.inserted} inseriti, ${result.updated} aggiornati, ${result.errors.length} errori, search ${result.searchUrls.join(", ") || "n/d"}`,
    ),
  ].join("\n");
}

function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendCronTelegramSummary(
  results: ProviderCronResult[],
  totals: {
    inserted: number;
    updated: number;
    errors: number;
  },
) {
  const topListings = results
    .flatMap((result) => result.listings)
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 3);
  const providerLine =
    results.map((result) => `${result.provider}: ${result.totalFound}`).join(" - ") ||
    "nessuna fonte";
  const topLine = topListings.length
    ? topListings
        .map(
          (listing) =>
            `${escapeTelegramHtml(listing.title)} (${listing.priorityScore} pt)`,
        )
        .join("\n")
    : "Nessuna scheda prioritaria.";
  const delivery = await sendTelegramMessage(
    [
      "<b>Listing Radar</b>",
      `Nuovi: ${totals.inserted} - Aggiornati: ${totals.updated} - Errori: ${totals.errors}`,
      `Fonti: ${providerLine}`,
      "",
      "<b>Top opportunità</b>",
      topLine,
    ].join("\n"),
  );

  if (!delivery.delivered && !delivery.skipped) {
    console.warn("[cron] telegram notification failed", delivery);
  }
}

async function handleCronRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  let runId: string | null = null;

  try {
    const emailAlerts = await ingestEmailAlerts();
    const { data: runRow, error: runError } = await supabase
      .from("scrape_runs")
      .insert({
        status: "running",
      })
      .select("id")
      .single();

    if (runError || !runRow?.id) {
      throw new Error("Unable to create scrape run.");
    }

    runId = runRow.id;
    const activeRunId = runRow.id;

    const providers = getProvidersForRun(process.env.SCRAPER_PROVIDER);
    const providerResults: ProviderCronResult[] = [];

    for (const provider of providers) {
      providerResults.push(await runProvider(provider, activeRunId));
    }

    const persistedListings = providerResults.flatMap((result) => result.listings);
    const scoringConfig = await getPersistedScoringConfig();
    const report = generateReport(persistedListings, new Date(), scoringConfig);
    const reportContent = `${report.content}${buildProviderReport(providerResults)}`;

    const { data: reportRow, error: reportError } = await supabase
      .from("reports")
      .insert({
        report_date: report.reportDate,
        total_found: report.totalFound,
        new_count: report.newCount,
        private_count: report.privateCount,
        agency_count: report.agencyCount,
        unknown_count: report.unknownCount,
        price_drops_count: report.priceDropsCount,
        hot_old_count: report.hotOldCount,
        content: reportContent,
      })
      .select("id")
      .single();

    if (reportError) {
      throw new Error("Unable to save report.");
    }

    const totalFound = providerResults.reduce(
      (sum, result) => sum + result.totalFound,
      0,
    );
    const totalInserted = providerResults.reduce(
      (sum, result) => sum + result.inserted,
      0,
    );
    const totalUpdated = providerResults.reduce(
      (sum, result) => sum + result.updated,
      0,
    );
    const totalSnapshots = providerResults.reduce(
      (sum, result) => sum + result.snapshots,
      0,
    );
    const errorCount = providerResults.reduce(
      (sum, result) => sum + result.errors.length,
      0,
    );

    await sendCronTelegramSummary(providerResults, {
      inserted: totalInserted,
      updated: totalUpdated,
      errors: errorCount,
    });

    await finalizeRun(activeRunId, {
      status: errorCount > 0 ? "completed_with_errors" : "success",
      total_found: totalFound,
      total_inserted: totalInserted,
      total_updated: totalUpdated,
      error_count: errorCount,
    });

    /* Una lettura delle fonti cambia l'archivio: le viste in cache vanno
     * buttate, altrimenti il risultato del run si vede un minuto dopo. */
    revalidateTag(LIFECYCLE_CACHE_TAG, { expire: 0 });
    revalidatePath("/listings");
    revalidatePath("/incoming");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath("/map");

    return NextResponse.json({
      ok: true,
      runId: activeRunId,
      reportId: reportRow?.id ?? null,
      provider: process.env.SCRAPER_PROVIDER ?? "mock",
      emailAlerts,
      providers: providerResults.map((result) => ({
        provider: result.provider,
        ok: result.ok,
        totalFound: result.totalFound,
        inserted: result.inserted,
        updated: result.updated,
        snapshots: result.snapshots,
        searchUrls: result.searchUrls,
        foundUrls: result.foundUrls,
        detailPagesRead: result.detailPagesRead,
        errors: result.errors.map((error) => ({
          type: error.type,
          message: error.message,
          url: error.url ?? null,
        })),
      })),
      inserted: totalInserted,
      updated: totalUpdated,
      snapshots: totalSnapshots,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected scrape failure.";

    if (runId) {
      await supabase.from("scrape_errors").insert({
        scrape_run_id: runId,
        source: "system",
        message,
        details:
          error instanceof Error
            ? {
                name: error.name,
                stack: error.stack ?? null,
              }
            : null,
      });

      await finalizeRun(runId, {
        status: "error",
        error_count: 1,
      });
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
