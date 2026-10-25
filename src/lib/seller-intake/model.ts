import { z } from 'zod';

export const CASE_STATUSES = {
  NEW: 'Da verificare', IN_REVIEW: 'In verifica', TO_CALL: 'Da chiamare',
  CONTACTED: 'Contatto avvenuto', APPOINTMENT: 'Appuntamento fissato',
  APPOINTMENT_HELD: 'Appuntamento svolto',
  VALUATION: 'Valutazione svolta', MANDATE: 'Incarico acquisito',
  NURTURE: 'Da risentire', CLOSED: 'Chiusa', DO_NOT_CONTACT: 'Non contattare',
} as const;
export const ACTIONS = { VERIFY: 'Verificare le prove', CALL: 'Telefonare', FOLLOW_UP: 'Ricontattare', VISIT: 'Sopralluogo', NONE: 'Nessuna' } as const;
const text = (max: number) => z.string().trim().min(1).max(max);
export const inboundSchema = z.object({
  externalId: text(120).regex(/^[a-zA-Z0-9_-]+$/),
  formVersion: z.literal('seller_v1'),
  name: text(160),
  phone: z.string().trim().transform(v => v.replace(/[\s().-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{8,15}$/)),
  email: z.union([z.literal(''), z.email().max(254)]).optional(),
  answers: z.object({
    situation: z.enum(['considering_sale', 'understand_value', 'already_on_market', 'other']),
    role: z.enum(['owner', 'on_behalf', 'other']),
    locality: z.enum(['Bitonto', 'Palombaio', 'Mariotto', 'Bitonto_other']),
    propertyType: z.enum(['apartment', 'independent', 'villa', 'other']),
    timing: z.enum(['within_3_months', '3_6_months', 'later', 'undecided']),
    preferredTime: z.enum(['morning', 'afternoon', 'evening']).optional(),
  }).strict(),
  callbackRequested: z.literal(true),
  whatsappOptIn: z.boolean().default(false),
  privacyVersion: text(80),
  attribution: z.object({
    source: z.enum(['meta_form', 'local_test']),
    campaignId: text(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    adsetId: text(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    adId: text(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    formId: text(120).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  }).strict(),
}).strict();
export type InboundSubmission = z.infer<typeof inboundSchema>;
export const reviewSchema = z.object({
  id: z.uuid(), revision: z.coerce.number().int().nonnegative(),
  status: z.enum(Object.keys(CASE_STATUSES) as [keyof typeof CASE_STATUSES, ...Array<keyof typeof CASE_STATUSES>]),
  nextAction: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...Array<keyof typeof ACTIONS>]),
  nextActionAt: z.string().datetime({ offset: true }).nullable(), note: text(2000),
}).strict().superRefine((v, ctx) => {
  const terminal = ['CLOSED', 'DO_NOT_CONTACT', 'MANDATE'].includes(v.status);
  if (!terminal && (v.nextAction === 'NONE' || !v.nextActionAt)) ctx.addIssue({ code: 'custom', message: 'Indica il prossimo passo e quando svolgerlo.' });
  if (terminal && (v.nextAction !== 'NONE' || v.nextActionAt)) ctx.addIssue({ code: 'custom', message: 'Una pratica chiusa non può avere un ricontatto in coda.' });
});
