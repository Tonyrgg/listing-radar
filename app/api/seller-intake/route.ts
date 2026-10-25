import { getSupabaseServiceClient } from '@/lib/supabase/service';
import { ingestSellerSubmission, IntakeConflictError } from '@/lib/seller-intake/ingest';
import { intakeAuthorized, localIntakeReady } from '@/lib/seller-intake/local-gate';
import { ZodError } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (!localIntakeReady()) return Response.json({ error: 'Ingresso non attivo.' }, { status: 503, headers });
  if (!intakeAuthorized(request.headers.get('authorization'), process.env.SELLER_INTAKE_TOKEN!))
    return Response.json({ error: 'Accesso non autorizzato.' }, { status: 401, headers });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return Response.json({ error: 'Usa JSON.' }, { status: 415, headers });
  // Bound actual streamed bytes; do not trust Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'Richiesta vuota.' }, { status: 400, headers });
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 12_000) { await reader.cancel(); return Response.json({ error: 'Richiesta troppo grande.' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await ingestSellerSubmission(getSupabaseServiceClient(), process.env.SELLER_INTAKE_OWNER_ID!, input);
    return Response.json({ received: true, ...result }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof IntakeConflictError)
      return Response.json({ error: 'Identificativo già ricevuto con dati diversi. La richiesta originale è conservata.' }, { status: 409, headers });
    if (error instanceof SyntaxError || error instanceof ZodError)
      return Response.json({ error: 'Dati incompleti o non validi.' }, { status: 400, headers });
    return Response.json({ error: 'Salvataggio non confermato. Riprova con lo stesso identificativo.' }, { status: 503, headers });
  } finally { reader.releaseLock(); }
}
