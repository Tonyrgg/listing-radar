import { getLatestWorkerRelease } from "@/lib/worker-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await getLatestWorkerRelease();
    return Response.json(
      {
        published: true,
        version: release.version,
        releaseDate: release.releaseDate,
        size: release.size,
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return Response.json(
      { published: false, version: null, releaseDate: null, size: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
