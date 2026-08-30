"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * «Sto caricando», per tutto il tempo che ci vuole.
 *
 * La versione precedente mostrava l'avviso al clic e lo toglieva dopo un
 * secondo e otto decimi, misurati con un timer. Se la pagina ci metteva di
 * più — e l'archivio ci metteva di più — l'avviso spariva mentre il lavoro era
 * ancora in corso: da quel momento il programma sembrava bloccato, ed era il
 * momento in cui stava lavorando di più.
 *
 * Adesso l'attesa finisce quando finisce davvero: quando cambia l'indirizzo
 * (una navigazione è arrivata) o quando il server rimanda un disegno nuovo
 * (un'azione ha salvato e ricaricato). Il timer resta solo come rete di
 * sicurezza per una connessione morta.
 *
 * Sotto i 150 millisecondi non si mostra niente: un lampo a ogni clic è
 * rumore, non riscontro.
 */

/** Sotto questa soglia la risposta è già arrivata: mostrare l'attesa infastidisce. */
const RITARDO_MS = 150;

/** Rete di sicurezza: se il server non risponde più, il velo non resta per sempre. */
const LIMITE_MS = 30_000;

function etichetta(control: HTMLElement) {
  const testo = (control.getAttribute("aria-label") || control.textContent || "").trim();
  if (!testo) return "Caricamento";
  return `${testo.slice(0, 52)}…`;
}

export function GlobalActionLoader({ segnoDiDisegno }: Readonly<{ segnoDiDisegno: number }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [attesa, setAttesa] = useState<string | null>(null);

  /* La destinazione del clic: se l'indirizzo cambia, l'attesa è finita. */
  const posizione = `${pathname}?${searchParams.toString()}`;
  const posizioneIniziale = useRef(posizione);
  const disegnoIniziale = useRef(segnoDiDisegno);

  useEffect(() => {
    let apparizione: ReturnType<typeof setTimeout> | null = null;
    let scadenza: ReturnType<typeof setTimeout> | null = null;

    function annulla() {
      if (apparizione) clearTimeout(apparizione);
      if (scadenza) clearTimeout(scadenza);
      apparizione = null;
      scadenza = null;
    }

    function attendi(testo: string) {
      annulla();
      posizioneIniziale.current = posizione;
      disegnoIniziale.current = segnoDiDisegno;
      apparizione = setTimeout(() => setAttesa(testo), RITARDO_MS);
      scadenza = setTimeout(() => {
        annulla();
        setAttesa(null);
      }, LIMITE_MS);
    }

    /* Solo i collegamenti e i moduli: un bottone può aprire un pannello senza
     * chiedere niente al server, e annunciare un'attesa che non c'è è peggio
     * che non annunciarne una che c'è. I bottoni che salvano stanno dentro un
     * modulo, e passano di qui dall'invio. */
    function alClic(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const collegamento = target?.closest<HTMLAnchorElement>("a[href]");
      if (!collegamento || collegamento.dataset.noGlobalLoader !== undefined) return;
      if (collegamento.target === "_blank") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (collegamento.getAttribute("download") !== null) return;

      /* Un'ancora verso un punto della pagina, o verso la pagina stessa, non
       * apre niente: non c'è nessuna attesa da annunciare. */
      const href = collegamento.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      if (href.startsWith("http") && !href.startsWith(window.location.origin)) return;
      if (collegamento.pathname === window.location.pathname &&
          collegamento.search === window.location.search) return;

      attendi(etichetta(collegamento));
    }

    function alInvio(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.dataset.noGlobalLoader !== undefined) return;
      /* Un filtro e una ricerca chiedono, non salvano: dire «salvataggio»
       * mentre si cambia una tendina è una bugia piccola ma continua. */
      const chiede = form.method.toLowerCase() === "get";
      attendi(chiede ? "Caricamento…" : "Salvataggio in corso…");
    }

    document.addEventListener("click", alClic, true);
    document.addEventListener("submit", alInvio, true);

    return () => {
      document.removeEventListener("click", alClic, true);
      document.removeEventListener("submit", alInvio, true);
      annulla();
    };
  }, [posizione, segnoDiDisegno]);

  /* L'attesa finisce quando arriva la cosa attesa: una pagina nuova, oppure un
   * disegno nuovo mandato dal server dopo un salvataggio. */
  useEffect(() => {
    if (posizione !== posizioneIniziale.current || segnoDiDisegno !== disegnoIniziale.current) {
      posizioneIniziale.current = posizione;
      disegnoIniziale.current = segnoDiDisegno;
      setAttesa(null);
    }
  }, [posizione, segnoDiDisegno]);

  if (!attesa) return null;

  return (
    <>
      <div className="lr-action-progress" aria-hidden="true" />
      <div className="lr-action-loader" role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="size-4" />
        {attesa}
      </div>
    </>
  );
}
