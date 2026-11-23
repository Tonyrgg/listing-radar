import { NextRequest, NextResponse } from "next/server";
import { workspaceOwner } from "@/lib/workspace-state";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { LifecycleJobQueue } from "@/lib/property-lifecycle/jobs/queue";
import { PRIVATE_PORTAL_LABELS } from "@/lib/property-lifecycle/jobs/source-scan-targets";

const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function wakeRunner(): Promise<boolean> {
  const token = process.env.LIFECYCLE_DISPATCH_TOKEN;
  const repository = process.env.LIFECYCLE_DISPATCH_REPOSITORY;
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return false;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/property-lifecycle.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ ref: "main", inputs: { job_type: "DRAIN_QUEUE", max_jobs: "20" } }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  if (!await workspaceOwner()) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401, headers });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !uuid.test(id)) return NextResponse.json({ error: "Scansione non valida" }, { status: 400, headers });
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("lifecycle_jobs").select("status,job_type,payload,agency_id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Stato non disponibile" }, { status: 503, headers });
  if (!data || !["DEEP_SYNC_AGENCY","SYNC_PRIVATE_RADAR"].includes(data.job_type)) return NextResponse.json({ error: "Scansione non trovata" }, { status: 404, headers });
  if (data.status !== "SUCCEEDED") return NextResponse.json({ status: data.status }, { headers });

  if (data.job_type === "DEEP_SYNC_AGENCY") {
    const result = await db.from("sync_runs").select("health_state,inventory_complete").eq("job_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    const quality = result.data?.health_state === "HEALTHY" && result.data.inventory_complete ? "COMPLETE" : "PARTIAL";
    return NextResponse.json({ status: data.status, quality }, { headers });
  }
  const source = data.payload?.portal;
  const result = await db.from("private_radar_source_health").select("state,diagnostics,discovered_count").eq("source", source).maybeSingle();
  return NextResponse.json({
    status: data.status, quality: result.data?.state === "DEGRADED" ? "PARTIAL" : "SAMPLE",
    details: Array.isArray(result.data?.diagnostics) ? result.data.diagnostics.filter((v:unknown)=>typeof v==="string" && /^(Campione|Ricerca|Ordine)/.test(v)) : [],
    discovered: result.data?.discovered_count ?? null,
  }, { headers });
}

export async function POST(request: NextRequest) {
  if (!await workspaceOwner()) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non valida" }, { status: 415, headers });
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || !("kind" in input) || !("key" in input) || typeof input.key !== "string") {
    return NextResponse.json({ error: "Fonte non valida" }, { status: 400, headers });
  }
  const db = getSupabaseServiceClient();
  const queue = new LifecycleJobQueue(db);
  const requestedFrom = "SOURCE_CONTROLS";
  try {
    let job;
    if (input.kind === "agency" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(input.key)) {
      const agency = await db.from("agencies").select("id").eq("slug", input.key).eq("enabled", true).maybeSingle();
      if (agency.error) throw new Error("Fonte non disponibile");
      if (!agency.data) return NextResponse.json({ error: "Agenzia non disponibile" }, { status: 404, headers });
      job = await queue.enqueue({ jobType: "DEEP_SYNC_AGENCY", agencyId: agency.data.id, priority: 100, payload: { requestedFrom } });
    } else if (input.kind === "portal" && Object.hasOwn(PRIVATE_PORTAL_LABELS, input.key)) {
      job = await queue.enqueue({ jobType: "SYNC_PRIVATE_RADAR", priority: 100, payload: { requestedFrom, portal: input.key },
        dedupeKey: `source-scan:portal:${input.key}`, maxAttempts: 1 });
    } else {
      return NextResponse.json({ error: "Fonte non valida" }, { status: 400, headers });
    }
    const signalled = job.status === "QUEUED" && await wakeRunner();
    return NextResponse.json({ id: job.id, status: job.status, signalled }, { status: 202, headers });
  } catch {
    return NextResponse.json({ error: "Scansione non accodata. Riprova." }, { status: 503, headers });
  }
}
