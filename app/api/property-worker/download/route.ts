import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PROPERTY_WORKER_RELEASE } from "@/lib/property-worker/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canDownloadWorker() {
  const authRequired =
    process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";

  if (!authRequired) return true;

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();

  return Boolean(
    data.user && (!allowedEmail || data.user.email?.toLowerCase() === allowedEmail),
  );
}

export async function GET() {
  if (!(await canDownloadWorker())) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const downloadUrl = process.env.PROPERTY_WORKER_DOWNLOAD_URL?.trim()
    || PROPERTY_WORKER_RELEASE.downloadUrl;

  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      Location: downloadUrl,
    },
  });
}
