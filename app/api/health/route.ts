import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const supabase = getSupabaseServiceClient();
    // Probe the archive users actually read, not an unrelated small table.
    const [{ error },state] = await Promise.all([
      supabase.from("radar_property_live_archive").select("property_id").limit(1),
      supabase.from("radar_read_model_state").select("refreshed_at,last_error,source_revision,refreshed_revision").single(),
    ]);

    if (error || state.error) {
      throw error ?? state.error;
    }

    return NextResponse.json(
      {
        ok: true,
        status: state.data.last_error ? "degraded" : "healthy",
        archive: {
          refreshedAt: state.data.refreshed_at,
          updatePending: state.data.source_revision !== state.data.refreshed_revision,
          refreshFailed: Boolean(state.data.last_error),
        },
        services: {
          application: "up",
          database: "up",
        },
        checkedAt,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        services: {
          application: "up",
          database: "down",
        },
        checkedAt,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
