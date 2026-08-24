import { cookies } from "next/headers";

import { FLASH_COOKIE, type Flash } from "@/lib/flash-shared";

/**
 * Livello di riscontro: ogni azione che cambia qualcosa lascia un messaggio.
 *
 * L'azione server scrive un cookie di breve durata, il guscio dell'app lo legge
 * al render successivo e il client lo cancella dopo averlo mostrato. Serve a far
 * convivere le conferme con `revalidatePath`, senza riscrivere ogni form.
 */

export { FLASH_COOKIE };
export type { Flash, FlashTone } from "@/lib/flash-shared";

export async function setFlash(flash: Flash) {
  const store = await cookies();
  store.set(FLASH_COOKIE, JSON.stringify(flash), {
    path: "/",
    maxAge: 30,
    httpOnly: false,
    sameSite: "lax",
  });
}

export async function readFlash(): Promise<Flash | null> {
  const store = await cookies();
  const raw = store.get(FLASH_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Flash;
    return parsed.message ? parsed : null;
  } catch {
    return null;
  }
}
