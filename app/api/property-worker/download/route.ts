import { getLatestWorkerRelease } from "@/lib/worker-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function problem(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Reindirizza direttamente all'asset GitHub della release. Il binario non
 * attraversa Vercel o Supabase e resta scaricabile anche se il database è
 * temporaneamente limitato.
 */
export async function GET() {
  try {
    const release = await getLatestWorkerRelease();
    return new Response(null, {
      status: 307,
      headers: {
        "Cache-Control": "no-store",
        Location: release.downloadUrl,
        "X-Worker-Version": release.version,
      },
    });
  } catch (error) {
    return problem(
      `Il programma non è momentaneamente disponibile: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }
}
