import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inboundSchema } from './model';
export class IntakeConflictError extends Error {}

export async function ingestSellerSubmission(db: SupabaseClient, ownerId: string, input: unknown) {
  const submission = inboundSchema.parse(input);
  // Zod fixes key order. A replay can never replace the original answers or reopen a closed case.
  const signature = createHash('sha256').update(JSON.stringify(submission)).digest('hex');
  const { data, error } = await db.rpc('receive_seller_submission', {
    p_owner: ownerId, p_external: `${submission.attribution.source}:${submission.externalId}`,
    p_signature: signature, p_submission: submission,
  });
  if (error?.code === '23505') throw new IntakeConflictError('CONFLICTING_REPLAY');
  if (error) throw new Error('INTAKE_PERSISTENCE_FAILED');
  return data as { id: string; duplicate: boolean };
}
