import { permanentRedirect } from "next/navigation";

/**
 * C'erano due archivi: questo e Immobili. Mostravano le stesse case con nomi
 * diversi, e nessuno dei due era «quello giusto». Resta Immobili, che parte
 * dalle foto; questo indirizzo continua a funzionare per i vecchi link.
 */
export default function ArchivioLifecycleRedirect(): never {
  permanentRedirect("/listings");
}
