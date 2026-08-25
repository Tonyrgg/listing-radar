import { permanentRedirect } from "next/navigation";

/**
 * C'erano due pagine con le stesse dieci agenzie: questa, che ne mostrava
 * l'inventario, e Le fonti, che ne mostrava la salute. Sono la stessa domanda
 * — di chi mi posso fidare, e cosa tiene — e adesso è una pagina sola.
 */
export default function AgenzieRedirect(): never {
  permanentRedirect("/fonti");
}
