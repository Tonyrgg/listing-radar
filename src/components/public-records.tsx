import { Chip, Meta, buttonClass } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { PUBLIC_RECORD_LABELS, type PublicRecord } from "@/lib/property-lifecycle/buildings/read-model";

export function PublicRecords({records,propertyContext=false}:{records:PublicRecord[];propertyContext?:boolean}) {
  return <div className="space-y-3">
    <Meta>{propertyContext?"Documenti associati al civico o edificio. Il collegamento alla singola unità non è verificato.":"Registri e documenti pubblici del Comune, conservati con fonte e data di osservazione."} Non costituiscono una verifica di conformità urbanistica, catastale o di proprietà.</Meta>
    {!records.length?<p className="py-3 text-[var(--lr-ink-2)]">Nessun documento collegato con sufficiente precisione. L’assenza di documenti nell’archivio non prova l’assenza di pratiche.</p>:<div className="divide-y divide-[var(--lr-line-quiet)]">
      {records.map(r=><article key={r.id} className="py-4">
        <div className="flex flex-wrap items-center gap-2"><Chip>{PUBLIC_RECORD_LABELS[r.record_type]??r.record_type}</Chip>{r.area_name?<Chip>{r.area_name} · contesto di area</Chip>:null}{propertyContext?<Chip>Edificio · unità da verificare</Chip>:null}</div>
        <h3 className="mt-2 font-[650]">{r.title}</h3>
        {r.address_text?<p className="mt-1 text-[var(--lr-ink-2)]">{r.address_text}</p>:null}
        <Meta>{r.practice_status}{r.practice_date?` · Data pratica nel registro ${formatDate(r.practice_date)}`:""}{r.document_date?` · Data documento ${formatDate(r.document_date)}`:""}{r.published_at?` · Pubblicato ${formatDate(r.published_at)}`:""}</Meta>
        <div className="mt-2 flex flex-wrap gap-2">{r.document_url?<a className={buttonClass("secondary",{compact:true})} href={r.document_url} target="_blank" rel="noreferrer">Documento originale</a>:null}{r.source_url?<a className={buttonClass("quiet",{compact:true})} href={r.source_url} target="_blank" rel="noreferrer">Fonte pubblica</a>:null}</div>
        <details className="mt-2 text-[length:var(--lr-text-meta)]"><summary className="cursor-pointer py-2">Provenienza e riferimenti</summary><dl className="grid gap-2 break-words sm:grid-cols-2">
          <div><dt>Fonte</dt><dd>{r.source_key}</dd></div><div><dt>Ultimo riscontro</dt><dd>{formatDateTime(r.last_seen_at)}</dd></div>
          {r.protocol_number?<div><dt>Protocollo</dt><dd>{r.protocol_number}</dd></div>:null}
          <div className="min-w-0"><dt>Hash metadati sanitizzati</dt><dd className="break-all">{r.content_hash}</dd></div>
          {r.cadastral_references.length?<div><dt>Riferimenti dichiarati nel registro</dt><dd>{r.cadastral_references.map((c,i)=><p key={i}>Foglio {c.sheet??"non indicato"}, particella {c.parcel??"non indicata"}{c.subaltern?`, sub ${c.subaltern}`:""}</p>)}</dd></div>:null}
        </dl><Meta>{propertyContext?"Corrispondenza esatta del civico: confidenza alta sul contesto edificio, REVIEW per la singola unità.":r.area_name?"Contesto territoriale dichiarato dal catalogo. Nessuna zonizzazione attribuita automaticamente.":"Indirizzi e riferimenti conservati come dichiarati; nessun collegamento basato sul nome di una persona."}</Meta></details>
      </article>)}
    </div>}
  </div>;
}
