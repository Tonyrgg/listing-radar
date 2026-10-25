export const DELIVERY_LABELS = {
  BLOCKED: 'non attiva', PENDING: 'in attesa', CLAIMED: 'in lavorazione',
  RETRY: 'da riprovare', SENT: 'inviata e confermata dal trasporto',
  FAILED: 'non riuscita', CANCELLED: 'annullata',
} as const;
export type DeliveryStatus = keyof typeof DELIVERY_LABELS;
export function deliveryStatusLabel(status: string): string {
  return Object.hasOwn(DELIVERY_LABELS, status) ? DELIVERY_LABELS[status as DeliveryStatus] : 'stato non riconosciuto';
}
