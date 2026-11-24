import { requireUser } from "@/lib/auth";
import { isPropertyThumbnailPath, VISUALS_BUCKET } from "@/lib/property-thumbnail-path";

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isPropertyThumbnailPath(path)) return new Response(null, { status: 400 });
  if (!(await requireUser())) return new Response(null, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response(null, { status: 503 });

  try {
    const response = await fetch(new URL(`/storage/v1/object/authenticated/${VISUALS_BUCKET}/${path}`, url), {
      headers: { authorization: `Bearer ${key}`, apikey: key },
      signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store",
    });
    if (!response.ok || !response.body) {
      return new Response(null, { status: [400, 404].includes(response.status) ? 404 : 503 });
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/webp")) {
      return new Response(null, { status: 502 });
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
