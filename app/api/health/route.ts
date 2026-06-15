import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("scrape_runs")
      .select("id", { head: true, count: "exact" });

    if (error) {
      throw error;
    }

    return NextResponse.json(
      {
        ok: true,
        status: "healthy",
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
