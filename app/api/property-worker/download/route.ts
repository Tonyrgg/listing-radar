import { createHash } from "node:crypto";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scarica l'ultima versione del Property Worker da qualunque computer.
 *
 * Serve esattamente gli stessi file che usa l'aggiornamento automatico:
 * il manifest `latest.json` e le parti in `releases/<versione>/`. Così una
 * installazione nuova su un altro PC parte già dalla versione pubblicata,
 * e da lì in poi si aggiorna da sola.
 */
const BUCKET = "property-worker-updates";

type UpdateManifest = {
  version: string;
  fileName: string;
  size: number;
  sha256: string;
  chunks: Array<{ path: string; size: number; sha256: string }>;
};

async function isAllowed() {
  const authRequired =
    process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";

  if (!authRequired) {
    return true;
  }

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();

  return Boolean(
    data.user && (!allowedEmail || data.user.email?.toLowerCase() === allowedEmail),
  );
}

function problem(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET() {
  if (!(await isAllowed())) {
    return problem("Accesso non consentito.", 401);
  }

  const supabase = getSupabaseServiceClient();
  const storage = supabase.storage.from(BUCKET);

  const { data: manifestBlob, error: manifestError } = await storage.download("latest.json");

  if (manifestError || !manifestBlob) {
    return problem(
      "Non risulta pubblicata nessuna versione del programma. Pubblicane una con «npm run desktop:release» dal computer di sviluppo.",
      404,
    );
  }

  let manifest: UpdateManifest;

  try {
    manifest = JSON.parse(await manifestBlob.text()) as UpdateManifest;
  } catch {
    return problem("Il manifest della versione pubblicata non è leggibile.", 502);
  }

  if (!manifest.chunks?.length) {
    return problem("Il manifest della versione pubblicata è incompleto.", 502);
  }

  const parts: Buffer[] = [];

  for (const chunk of manifest.chunks) {
    const { data, error } = await storage.download(chunk.path);

    if (error || !data) {
      return problem(
        `Manca una parte del pacchetto (${chunk.path}). Ripubblica la versione dal computer di sviluppo.`,
        502,
      );
    }

    const buffer = Buffer.from(await data.arrayBuffer());

    if (buffer.length !== chunk.size) {
      return problem("Il pacchetto scaricato non è integro. Riprova fra poco.", 502);
    }

    parts.push(buffer);
  }

  const installer = Buffer.concat(parts);

  /* Stessa verifica che fa l'aggiornamento automatico:
   * meglio nessun file che un installer corrotto. */
  if (
    installer.length !== manifest.size ||
    createHash("sha256").update(installer).digest("hex") !== manifest.sha256
  ) {
    return problem("Il pacchetto scaricato non è integro. Riprova fra poco.", 502);
  }

  return new Response(new Uint8Array(installer), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${manifest.fileName.replaceAll('"', "")}"`,
      "Content-Length": String(installer.length),
      "Content-Type": "application/octet-stream",
      "X-Worker-Version": manifest.version,
    },
  });
}
