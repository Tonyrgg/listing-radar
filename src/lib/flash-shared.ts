/**
 * Parte del livello di riscontro condivisa fra server e client.
 * Non importa nulla da `next/headers`, così può vivere anche nei componenti client.
 */

export const FLASH_COOKIE = "lr-flash";

export type FlashTone = "success" | "danger" | "info";

export type Flash = {
  tone: FlashTone;
  message: string;
  /** Testo dell'azione di annullamento, quando l'operazione è reversibile. */
  undoLabel?: string;
  /** Percorso che ripristina lo stato precedente. */
  undoHref?: string;
};
