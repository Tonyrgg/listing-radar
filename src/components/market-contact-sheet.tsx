"use client";

import { useId, useRef } from "react";
import { X } from "lucide-react";
import { buttonClass } from "./ui/primitives";

export type MarketContactFacts = {
  owner: string | null;
  civic: string | null;
  position: string | null;
  precision: string | null;
  coordinates: string | null;
  floor: string | null;
  rooms: string | null;
};

export function MarketContactSheet({ label, facts }: { label: string; facts: MarketContactFacts }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const title = useId();
  const values = [
    ["Nominativo", facts.owner],
    ["Civico", facts.civic],
    ["Posizione", facts.position],
    ["Piano", facts.floor],
    ["Vani", facts.rooms],
  ];
  return <>
    <button type="button" ref={opener} className={buttonClass("secondary", { compact: true })}
      aria-label={`Dati per nominativo e immobile: ${label}`} aria-haspopup="dialog"
      onClick={() => dialog.current?.showModal()}>Dati</button>
    <dialog ref={dialog} className="lr-reading-dialog lr-market-contact" aria-labelledby={title}
      onClose={() => opener.current?.focus()} onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
      }}>
      <header>
        <h2 id={title}>Nominativo e immobile</h2>
        <button type="button" aria-label="Chiudi" className={buttonClass("quiet", { compact: true, icon: true })}
          onClick={() => dialog.current?.close()}><X size={18} aria-hidden="true" /></button>
      </header>
      <dl className="lr-market-contact-facts">
        {values.map(([field, value]) => <div key={field}>
          <dt>{field}</dt>
          <dd>
            {value ?? (field === "Posizione" && facts.coordinates ? facts.coordinates : <span aria-label="Dato non disponibile">?</span>)}
            {field === "Posizione" && facts.precision ? <small>{facts.precision}</small> : null}
            {field === "Posizione" && facts.coordinates ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(facts.coordinates)}`}
              target="_blank" rel="noreferrer">Apri il punto sulla mappa</a> : null}
          </dd>
        </div>)}
      </dl>
    </dialog>
  </>;
}
