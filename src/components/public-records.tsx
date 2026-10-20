import { Chip, Meta, buttonClass } from "@/components/ui/primitives";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { PUBLIC_RECORD_LABELS, type PublicRecord } from "@/lib/property-lifecycle/buildings/read-model";

export function PublicRecords({records,propertyContext=false}:{records:PublicRecord[];propertyContext?:boolean}) {
  return <div className="space-y-3">
    <Meta>{propertyContext?"Documenti associati al civico o edificio. Il collegamento alla singola unità non è verificato.":"Registri e documenti pubblici del Comune, conservati con fonte e data di osservazione."} Non costituiscono una verifica di conformità urbanistica, catastale o di proprietà.</Meta>
    {!records.length?<p className="py-3 text-[var(--lr-ink-2)]">Nessun documento collegato con sufficiente precisione. L’assenza di documenti nell’archivio non prova l’assenza di pratiche.</p>:<div className="divide-y divide-[var(--lr-line-quiet)]">
      {records.map(r=><article id={`record-${r.id}`} key={r.id} className="scroll-mt-20 py-4">
        <div className="flex flex-wrap items-center gap-2"><Chip>{PUBLIC_RECORD_LABELS[r.record_type]??"Atto pubblico"}</Chip>{r.area_name?<Chip>{r.area_name} · documento di area</Chip>:null}{r.relation_scope==="STREET"?<Chip>Contesto della via</Chip>:r.relation_scope==="AREA"?<Chip>Documento di area</Chip>:propertyContext||r.relation_scope==="BUILDING"?<Chip>Collegato all’edificio · unità da verificare</Chip>:null}{r.source_status&&/annull|revocat/i.test(r.source_status)?<Chip tone="warn">Annullato o revocato dalla fonte</Chip>:null}</div>
        <h3 className="mt-2 font-[650]">{r.title}</h3>
        {r.address_text&&!r.resolved_references?<p className="mt-1 text-[var(--lr-ink-2)]">{r.address_text}</p>:null}
        {r.subject?<p className="mt-1 max-w-prose text-[var(--lr-ink-2)]">{r.subject}</p>:null}
        {(r.resolved_references??r.territorial_references)?.length?<div className="mt-2 flex flex-wrap gap-2">{(r.resolved_references??r.territorial_references)!.map((ref,i)=><span key={i}>{ref.streetId?<Link className="underline" href={`/map?via_id=${ref.streetId}#contesto`}>{ref.streetName}</Link>:ref.streetName}{ref.civicText?` · ${ref.civicText}`:""}{['RANGE','AMBIGUOUS'].includes(ref.civicState)?" · civico o intervallo da verificare":""}{!ref.streetId?" · strada da verificare":""}</span>)}</div>:null}
        <Meta>{r.practice_status}{r.practice_date?` · Data pratica nel registro ${formatDate(r.practice_date)}`:""}{r.document_date?` · Data documento ${formatDate(r.document_date)}`:""}{r.published_at?` · Pubblicato ${formatDate(r.published_at)}`:""}</Meta>
        {r.publication_start?<Meta>Periodo di pubblicazione {formatDate(r.publication_start)}{r.publication_end?` – ${formatDate(r.publication_end)}`:" · termine non dichiarato"}</Meta>:null}
        <div className="mt-2 flex flex-wrap gap-2"><Link className={buttonClass("quiet",{compact:true})} href={`/map?atto=${r.id}#atto`}>Contesto dell’atto</Link>{r.document_url?<a className={buttonClass("secondary",{compact:true})} href={r.document_url} target="_blank" rel="noreferrer">Documento originale</a>:null}{r.source_url?<a className={buttonClass("quiet",{compact:true})} href={r.source_url} target="_blank" rel="noreferrer">Fonte pubblica</a>:null}</div>
        <details className="mt-2 text-[length:var(--lr-text-meta)]"><summary className="cursor-pointer py-2">Provenienza e riferimenti</summary><dl className="grid gap-2 break-words sm:grid-cols-2">
          <div><dt>Fonte</dt><dd>{r.source_key}</dd></div><div><dt>Ultimo riscontro</dt><dd>{formatDateTime(r.last_seen_at)}</dd></div>
          <div><dt>Prima osservazione nostra</dt><dd>{formatDateTime(r.first_seen_at)}</dd></div>
          {r.office?<div><dt>Ufficio proponente</dt><dd>{r.office}</dd></div>:null}
          {r.territorial_policy_version?<div><dt>Proiezione territoriale</dt><dd>{r.territorial_policy_version} · {r.unmatched_cause??'Contesto edificio disponibile'}</dd></div>:null}
          {r.classification_confidence!=null?<div><dt>Classificazione del contenuto</dt><dd>Confidenza {Math.round(r.classification_confidence*100)}% · {r.classification_version}</dd></div>:null}
          {r.protocol_number?<div><dt>Protocollo</dt><dd>{r.protocol_number}</dd></div>:null}
          <div className="min-w-0"><dt>Hash metadati sanitizzati</dt><dd className="break-all">{r.content_hash}</dd></div>
          {r.cadastral_references.length?<div><dt>Riferimenti dichiarati nel registro</dt><dd>{r.cadastral_references.map((c,i)=><p key={i}>Foglio {c.sheet??"non indicato"}, particella {c.parcel??"non indicata"}{c.subaltern?`, sub ${c.subaltern}`:""}</p>)}</dd></div>:null}
        </dl>{(r.document_urls?.length??0)>1?<ul className="mt-3 space-y-2">{r.document_urls!.map((url,i)=><li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all underline">Allegato pubblico {i+1}</a></li>)}</ul>:null}<Meta>{r.relation_scope==="STREET"?"Contesto della strada, non associazione alla singola casa.":r.relation_scope==="AREA"?"Contesto di area, nessuna zonizzazione attribuita automaticamente.":propertyContext?"Corrispondenza del civico sul contesto edificio; singola unità da verificare.":r.area_name?"Contesto territoriale dichiarato; nessun vincolo attribuito automaticamente.":"Indirizzi e riferimenti conservati come dichiarati; nessun collegamento basato sul nome di una persona."}</Meta></details>
      </article>)}
    </div>}
  </div>;
}
