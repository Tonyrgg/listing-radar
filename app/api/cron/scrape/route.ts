import { NextRequest, NextResponse } from "next/server";

import { upsertListings } from "@/lib/listings/upsert-listings";
import { generateReport } from "@/lib/reports/generate-report";
import { getProvider } from "@/lib/scrapers/providers";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

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

async function handleCronRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  let runId: string | null = null;

  try {
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

    const provider = getProvider("mock");
    const normalizedListings = await provider.fetchListings();
    const upsertResult = await upsertListings(normalizedListings);
    const report = generateReport(upsertResult.listings);

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
        content: report.content,
      })
      .select("id")
      .single();

    if (reportError) {
      throw new Error("Unable to save report.");
    }

    const activeRunId = runId;

    if (!activeRunId) {
      throw new Error("Missing scrape run identifier.");
    }

    await finalizeRun(activeRunId, {
      status: "success",
      total_found: normalizedListings.length,
      total_inserted: upsertResult.inserted,
      total_updated: upsertResult.updated,
      error_count: 0,
    });

    return NextResponse.json({
      ok: true,
      runId: activeRunId,
      reportId: reportRow?.id ?? null,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      snapshots: upsertResult.snapshots,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected scrape failure.";

    if (runId) {
      await supabase.from("scrape_errors").insert({
        scrape_run_id: runId,
        source: "mock",
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
