import { NextRequest, NextResponse } from "next/server";

import { ingestEmailAlerts } from "@/lib/email-alerts/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const result = await ingestEmailAlerts({
    reprocessProcessed:
      request.nextUrl.searchParams.get("reprocess") === "true",
  });

  return NextResponse.json({
    ok: result.errors.length === 0,
    emailAlerts: result,
  });
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
