import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dice quale versione del Property Worker è pubblicata in questo momento.
 * La pagina Impostazioni la mostra accanto al pulsante di download, così si
 * capisce a colpo d'occhio se l'installazione su un altro computer è indietro.
 */
export async function GET() {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from("property-worker-updates")
    .download("latest.json");

  if (error || !data) {
    return Response.json(
      { published: false, version: null, releaseDate: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const manifest = JSON.parse(await data.text()) as {
      version?: string;
      releaseDate?: string;
      size?: number;
    };

    return Response.json(
      {
        published: Boolean(manifest.version),
        version: manifest.version ?? null,
        releaseDate: manifest.releaseDate ?? null,
        size: manifest.size ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { published: false, version: null, releaseDate: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
