import {QuickSaleDecision} from "@/components/casa/quick-sale-decision";
import { ArrowLeft, CheckCircle2, FileCheck2, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MappaDellaCasa } from "@/components/casa/mappa-della-casa";
import { ListingPhotoGallery } from "@/components/listing-photo-gallery";
import { CopySourceLink } from "@/components/casa/copy-source-link";
import { PropertyPriceHistory } from "@/components/casa/property-price-history";
import { isMarketMove } from "@/lib/property-lifecycle/read-models/market-events";
import {dossierContext,dossierReturn} from "@/lib/property-lifecycle/read-models/dossier-context";
import { marketAgeLabel } from "@/lib/property-lifecycle/read-models/intelligence";
import { RigaDiVita } from "@/components/casa/riga-di-vita";
import { PendingSubmitButton } from "@/components/loading-controls";
import {
  Dato,
  Stato,
  certaintyFromConfidence,
  formaFromAgencyState,
  formaFromPropertyState,
} from "@/components/ui/atoms";
import {
  Campo,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meta,
  Scelta,
  Testo,
  buttonClass,
} from "@/components/ui/primitives";
import { getCurrentUser } from "@/lib/auth";
import { getSourceLabel } from "@/lib/labels";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatShouty,
} from "@/lib/formatting";
import {
  agencyListingStateLabel,
  hasNoRealSignal,
  humanize,
  identityOutcomeLabel,
  lifecycleEventLabel,
  locationPrecisionLabel,
  opportunityReasonLabel,
  publicationStateLabel,
  propertyStateLabel,
} from "@/lib/property-lifecycle/read-models/presentation";
import { formaPosizione } from "@/lib/map/posizione-casa";
import type { LifecyclePropertyDetail } from "@/lib/property-lifecycle/read-models/types";

import {
  flagPropertyForLifecycleReview,
  recordAgencyOutcomeOverride,
} from "@/app/(private)/lifecycle/actions";
import {
  ExternalSourceLink,
} from "@/app/(private)/lifecycle/_components/ui";
import styles from "@/app/(private)/lifecycle/lifecycle.module.css";

export const metadata: Metadata = { title: "Scheda della casa" };

/** I metodi che datano la casa guardando le foto, non l'annuncio. */
function dataDallaFoto(method: string | null) {
  return Boolean(method) && /IMAGE_FILENAME|MEDIA_LAST_MODIFIED|UPLOAD_PATH/.test(method!);
}

/**
 * Le prove, una per cosa affermata.
 *
 * Lo stesso indizio arriva a ogni passaggio del crawler: «Dove si trova» tre
 * volte, con la stessa origine e tre date. Di quel gruppo conta la più vecchia,
 * perché è quella che sposta indietro l'età reale di mercato.
 */
function proveDistinte(evidence: LifecyclePropertyDetail["evidence"]) {
  const migliori = new Map<
    string,
    LifecyclePropertyDetail["evidence"][number]
  >();

  for (const prova of evidence) {
    const chiave = `${prova.publicationId ?? prova.sourceUrl ?? ""}|${prova.claimKey}|${prova.extractionMethod}|${JSON.stringify(prova.normalizedValue??prova.rawValue??null)}`;
    const quando = prova.sourceRecordedAt ?? prova.observedAt;
    const gia = migliori.get(chiave);

    if (!gia || quando < (gia.sourceRecordedAt ?? gia.observedAt)) {
      migliori.set(chiave, prova);
    }
  }

  return [...migliori.values()].sort((a, b) =>
    (a.sourceRecordedAt ?? a.observedAt).localeCompare(
      b.sourceRecordedAt ?? b.observedAt,
    ),
  );
}

/** Le foto: una grande e la fila delle altre, senza mangiarsi la pagina. */
function MuroDiFoto({
  urls,
  alt,
  didascalia,
}: Readonly<{ urls: readonly string[]; alt: string; didascalia?: string }>) {
  return <div className="lr-dossier-gallery"><ListingPhotoGallery title={alt} imageUrls={[...urls]}/>{didascalia?<Meta>{didascalia}</Meta>:null}</div>;
}

function ChiLaTiene({ detail }: Readonly<{ detail: LifecyclePropertyDetail }>) {
  const { property, publications, privatePublications } = detail;
  const niente =
    !property.agencies.length &&
    !publications.length &&
    !privatePublications.length;

  if (niente) {
    return (
      <EmptyState
        title="Nessuno la sta vendendo, per quanto vediamo"
        description="Non risultano pubblicazioni attive su questa casa."
      />
    );
  }

  return (
    <div className="space-y-3">
      {property.agencies.map((agency) => (
        <div
          key={agency.listingId}
          className="rounded-[var(--lr-radius-control)] border border-[var(--lr-line-quiet)] bg-[var(--lr-raised)] p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              href={`/lifecycle/agencies/${agency.slug}`}
              className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)] hover:underline"
            >
              {formatShouty(agency.name)}
            </Link>
            <Stato forma={formaFromAgencyState(agency.state)}>
              {agencyListingStateLabel(agency.state)}
            </Stato>
          </div>
          <Meta>
            Osservata dal {formatDate(agency.firstSeenAt)}, vista l&apos;ultima volta il{" "}
            {formatDate(agency.lastSeenAt)}
            {agency.reference ? ` · rif. ${agency.reference}` : ""}
          </Meta>
        </div>
      ))}

      {publications.map((publication) => (
        <div
          key={publication.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <span className="text-[length:var(--lr-text-body)] text-[var(--lr-ink)]">
            {formatShouty(publication.agencyName)}
          </span>
          <Meta>
            {new URL(publication.canonicalUrl).hostname.replace(/^www\./, "")} ·{" "}
            {publicationStateLabel(publication.state)} · osservato dal{" "}
            {formatDate(publication.firstSeenAt)}
            {` · ultima presenza ${formatDate(publication.lastSeenAt)}`}
            {publication.portalPublishedAt ? ` · pubblicato dalla fonte il ${formatDate(publication.portalPublishedAt)}` : ""}
            {publication.portalModifiedAt ? ` · modifica fonte ${formatDate(publication.portalModifiedAt)}` : ""}
          </Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}

      {privatePublications.map((publication) => (
        <div
          key={publication.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <Stato forma="privato">
            Annuncio di un privato su {getSourceLabel(publication.source)}
          </Stato>
          <Meta>
            <Dato
              certainty={certaintyFromConfidence(publication.identityScore)}
            >
              stessa casa{" "}
              {identityOutcomeLabel(
                publication.identityOutcome,
              ).toLocaleLowerCase("it")}
            </Dato>
          </Meta>
          <ExternalSourceLink href={publication.canonicalUrl} />
        </div>
      ))}
    </div>
  );
}


export function SchedaMercato({detail,user,now,children,origin,returnTo}:Readonly<{
 detail:LifecyclePropertyDetail;user:Awaited<ReturnType<typeof getCurrentUser>>;now:number;children?:React.ReactNode;origin?:string;returnTo?:string;
}>){
 const property=detail.property;
 const manualSale=property.saleStatus==="SOLD_CONFIRMED"&&detail.manualOverrides.some(o=>o.key==="sale_status"&&o.value==="SOLD_CONFIRMED");
 const saleDate=detail.marketObservation?.soldAt??detail.marketObservation?.soldObservedAt;
 const marketEnd=saleDate?Date.parse(saleDate):now;
 const currentAsking=detail.marketObservation?.latestPrice??property.currentPrice;
 const marketAnchor=property.earliestMarketEvidenceAt??property.firstSeenAt;
 const indirizzo=formatShouty(property.address||property.title);
 const dove=[...new Set([detail.location?.streetName,detail.location?.locality,detail.location?.municipality||property.locality].filter(Boolean))].join(" · ");
 const euroAlMq=currentAsking!=null&&property.surfaceSqm?Math.round(currentAsking/property.surfaceSqm):null;
 const prove=proveDistinte(detail.evidence);
 const forma=formaPosizione(detail.location);
 const source=detail.marketObservation?.sourceUrl??detail.publications[0]?.canonicalUrl??detail.privatePublications[0]?.canonicalUrl;
 const recentEvents=[...detail.events].filter(e=>isMarketMove(e.eventType)).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
 const indizi=detail.opportunity&&!hasNoRealSignal(detail.opportunity.reasons)?detail.opportunity.reasons:[];
 const drops=detail.priceHistory.filter(e=>e.eventType==="PRICE_DROP").length;
 const sourcePrice=detail.publicationPrices?.find(p=>p.publicationId===(detail.marketObservation?.publicationId??detail.publications[0]?.id));
 const sourceCount=detail.publications.length+detail.privatePublications.length;
 const context=dossierContext(origin,detail.marketObservation?.classification,property.saleStatus);
 const returnHref=dossierReturn(returnTo,context.view);
 const historyUrl=(page:number)=>"?"+new URLSearchParams({origine:context.view,ritorno:returnHref,storia:String(page)})+"#storico";
 const historyFirst=context.view==="usciti"||context.view==="venduti";

 const historySection=(<section id="storico" className="lr-case-section"><h2>Storico e prove</h2><RigaDiVita eventi={detail.events} prove={prove}/><nav className="lr-radar-pagination" aria-label="Pagine dello storico">{(detail.historyPage??1)>1?<Link href={historyUrl((detail.historyPage??1)-1)} className={buttonClass("secondary",{compact:true})}>Più recenti</Link>:<span/>}<Meta>Pagina {detail.historyPage??1}</Meta>{detail.historyHasNext?<Link href={historyUrl((detail.historyPage??1)+1)} className={buttonClass("secondary",{compact:true})}>Precedenti</Link>:<span/>}</nav></section>);
 return <div className="lr-case-page" data-context={context.tone}>
  <header className="lr-case-header"><div><Link href={returnHref} className="lr-case-back"><ArrowLeft size={14} aria-hidden="true"/> Torna a {context.label}</Link><span className="lr-case-context-label">{context.label} · {context.view==="opportunita"?"Analisi":context.view==="venduti"?"Esito":context.view==="usciti"?"Storico":"Scheda immobile"}</span><h1>{indirizzo}</h1><p>{dove||"Posizione da verificare"}</p></div><Stato forma={formaFromPropertyState(property.propertyState)}>{propertyStateLabel(property.propertyState)}</Stato></header>
  <div className="lr-case-grid">
   <div className="lr-case-main" aria-label="Dossier dell’immobile">
    <section id="panoramica" className="lr-case-overview">
     <div className="lr-case-identity"><div><h2>{context.title}</h2><p>{context.description}</p></div><div className="lr-case-price"><strong>{formatCurrency(currentAsking)}</strong><span className="lr-case-price-label">{context.view==="venduti"||context.view==="usciti"?"Ultimo prezzo richiesto":"Prezzo richiesto"}</span><span>{euroAlMq!=null?formatNumber(euroAlMq)+" €/m²":"Prezzo richiesto"}</span></div></div>
     <div className="lr-case-tags">{[property.propertyType?humanize(property.propertyType):null,property.surfaceSqm!=null?formatNumber(property.surfaceSqm)+" m²":null,property.rooms!=null?formatNumber(property.rooms)+" locali":null].filter(Boolean).map(t=><span key={t}>{t}</span>)}</div>

     {context.view!=="mercato"?<section className="lr-case-focus" aria-label={"Sintesi "+context.label}>
      <div className="lr-case-focus-heading"><h3>{context.view==="opportunita"?"Perché compare tra le opportunità":context.view==="venduti"?context.outcome:"Cosa è successo all’annuncio"}</h3>{context.view==="opportunita"&&detail.opportunity?.score!=null?<span>Indice {formatNumber(detail.opportunity.score)}/100</span>:null}</div>
      {context.view==="opportunita"?<><ul>{indizi.length?indizi.map(reason=><li key={reason}>{opportunityReasonLabel(reason)}</li>):<li>La motivazione della segnalazione resta da verificare.</li>}</ul><p>Questi indizi non dimostrano intenzione di vendere o scadenza dell’incarico.</p></>:<>
       <dl className="lr-case-outcome-facts">{context.view!=="venduti"?<div><dt>Classificazione attuale</dt><dd>{context.outcome}</dd></div>:null}<div><dt>Ultima presenza</dt><dd>{formatDate(property.lastSeenAt)}</dd></div><div><dt>{context.view==="venduti"?(manualSale?"Conferma manuale registrata":"Segnale di vendita"):"Classificazione rilevata"}</dt><dd>{formatDate(context.view==="venduti"?saleDate:detail.marketObservation?.classifiedAt)}</dd></div></dl>
       <p>{context.view==="venduti"?(context.confirmed?"La vendita risulta confermata dalle informazioni disponibili. Il prezzo effettivo di compravendita non è disponibile.":context.probable?"È presente un segnale probabile: la vendita resta da confermare. Il richiesto non è il prezzo di compravendita.":"Non risulta una vendita confermata. La vista di provenienza non costituisce una prova."):"L’uscita o l’assenza di un annuncio non dimostra una vendita. Lo storico mostra eventuali ripubblicazioni o cambi di agenzia."}</p><a href="#storico">Leggi lo storico e le prove ↓</a>
      </>}
     </section>:null}
     <div className="lr-case-photo-summary">
      <MuroDiFoto urls={detail.imageUrls} alt={indirizzo} didascalia={dataDallaFoto(property.trueMarketStartMethod)&&property.trueMarketStartLowerBound?"Foto datata "+formatDate(property.trueMarketStartLowerBound):undefined}/>
      <div><h3 className="lr-case-label">In sintesi</h3><dl className="lr-case-summary">
       <div><dt>{context.view==="venduti"?"Osservazione della vendita":"Presenza osservata"}</dt><dd>{context.view==="venduti"&&saleDate&&Date.parse(saleDate)<=Date.parse(property.firstSeenAt)?"Segnale già presente al primo riscontro":marketAgeLabel(property.firstSeenAt,marketAnchor,marketEnd)}</dd><p>Prima osservazione: {formatDate(property.firstSeenAt)}</p></div>
       <div><dt>Prezzo</dt><dd>{formatNumber(sourcePrice?.dropCount??drops)} ribassi registrati</dd><p>{detail.marketObservation?.priceConflict?"Prezzi discordanti tra le fonti":sourcePrice?.firstPrice!=null?"Primo prezzo: "+formatCurrency(sourcePrice.firstPrice):"Storico iniziale non disponibile"}</p></div>
       <div><dt>Pubblicazioni</dt><dd>{formatNumber(sourceCount)} {sourceCount===1?"pubblicazione":"pubblicazioni"}</dd><p>{property.relaunchCount?formatNumber(property.relaunchCount)+" ripubblicazioni osservate":"Nessuna ripubblicazione registrata"}</p></div>
       <div><dt>Ultima presenza rilevata</dt><dd>{formatDate(property.lastSeenAt)}</dd><p>{saleDate?(manualSale?"Conferma manuale: ":"Segnale di vendita: ")+formatDate(saleDate):property.saleStatus==="SOLD_CONFIRMED"?"Vendita confermata":property.saleStatus==="NOT_SOLD_CONFIRMED"?"Non venduto, confermato manualmente":"Vendita non confermata"}</p></div>
      </dl></div>
     </div>
    </section>
    {historyFirst?historySection:null}
    <section id="prezzi" className="lr-case-section"><h2>Storico del prezzo richiesto</h2><PropertyPriceHistory events={detail.priceHistory} currentPrice={currentAsking} conflict={detail.marketObservation?.priceConflict}/></section>
    <section id="pubblicazioni" className="lr-case-section"><h2>Pubblicazioni e prezzi per fonte</h2><ChiLaTiene detail={detail}/>{detail.publicationPrices?.length?<div className="lr-case-price-sources">{detail.publicationPrices.map(price=><div key={price.publicationId}><a href={price.sourceUrl} target="_blank" rel="noreferrer">{new URL(price.sourceUrl).hostname.replace(/^www\./,"")}</a><span>{formatCurrency(price.firstPrice)} → {formatCurrency(price.latestPrice)}</span><span>{price.dropCount} ribassi</span></div>)}</div>:null}</section>
    {detail.location&&forma!=="niente"?<section id="territorio" className="lr-case-section"><h2>Posizione <span>{locationPrecisionLabel(detail.location.precision)}</span></h2><MappaDellaCasa posizione={detail.location} etichetta={indirizzo}/><p className="lr-case-footnote"><MapPin size={13} aria-hidden="true"/>{dove}{forma==="area"?" · area indicativa, non posizione esatta dell’immobile":""}</p></section>:null}
    {!historyFirst?historySection:null}
    {children}
          <details id="correggi" open className="lr-property-corrections"><summary>Correzione dati · azioni rapide</summary><Card>
        <CardHeader
          title="Correggi quello che sappiamo"
          meta="Ogni correzione resta scritta con il tuo nome, la data e il motivo. Quello che confermi non viene più sovrascritto da solo."
        />
        <CardBody>
          {user ? (
            <div className="grid gap-5 lg:grid-cols-3">
              <QuickSaleDecision propertyId={property.id} saleStatus={property.saleStatus}/>

              {property.agencies[0] ? (
                <form
                  action={recordAgencyOutcomeOverride}
                  className={styles.manualForm}
                >
                  <input type="hidden" name="propertyId" value={property.id} />
                  <input
                    type="hidden"
                    name="agencyListingId"
                    value={property.agencies[0].listingId}
                  />
                  <Campo
                    label={`Com'è finita con ${formatShouty(property.agencies[0].name)}?`}
                  >
                    <Scelta name="agencyState" defaultValue="CLOSED_WITHDRAWN">
                      <option value="CLOSED_WITHDRAWN">
                        Il proprietario ha ritirato
                      </option>
                      <option value="CLOSED_SWITCHED">
                        È passata a un&apos;altra agenzia
                      </option>
                      <option value="CLOSED_TO_PRIVATE">La vende da sé</option>
                      <option value="OFF_MARKET_NO_SALE_EVIDENCE">
                        Non è più in vendita, ma non risulta venduta
                      </option>
                    </Scelta>
                  </Campo>
                  <Campo label="Come lo sai?">
                    <Testo
                      name="reason"
                      required
                      minLength={5}
                      placeholder="Da dove viene la conferma"
                    />
                  </Campo>
                  <PendingSubmitButton
                    type="submit"
                    pendingLabel="Registro"
                    icon={
                      <CheckCircle2 aria-hidden="true" className="size-4" />
                    }
                    className={styles.secondaryAction}
                  >
                    Registra
                  </PendingSubmitButton>
                </form>
              ) : (
                <div />
              )}

              <form
                action={flagPropertyForLifecycleReview}
                className={styles.manualForm}
              >
                <input type="hidden" name="propertyId" value={property.id} />
                <Campo label="Qui c'è qualcosa che non torna">
                  <Testo
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Cosa va controllato"
                  />
                </Campo>
                <PendingSubmitButton
                  type="submit"
                  pendingLabel="Apro la verifica"
                  className={styles.secondaryAction}
                >
                  Mettila fra le cose da decidere
                </PendingSubmitButton>
              </form>
            </div>
          ) : (
            <EmptyState
              title="Per correggere serve essere riconosciuti"
              description="Ogni correzione porta un nome e una data: finché non c'è un utente, la scheda resta in sola lettura."
            />
          )}
        </CardBody>
      </Card></details>

   </div>
   <aside className="lr-case-aside" aria-label="Azioni e riscontri">
    <section><h2>Azioni</h2>{source?<><a href={source} target="_blank" rel="noreferrer" className="lr-case-source-button">Apri annuncio originale ↗</a><CopySourceLink url={source}/></>:<p className="lr-case-muted">Nessun annuncio originale collegato.</p>}<a href="#correggi" className="lr-case-copy"><FileCheck2 size={14} aria-hidden="true"/> Correggi o segnala un dato</a></section>
    <section><h2>Verifiche aperte</h2><ul className="lr-case-checks">{detail.marketObservation?.priceConflict?<li>Prezzi discordanti tra fonti.</li>:null}{!detail.location||!detail.location.manuallyVerified?<li>Posizione {detail.location?locationPrecisionLabel(detail.location.precision).toLowerCase():"non disponibile"}, da verificare.</li>:null}{property.saleStatus!=="SOLD_CONFIRMED"&&property.saleStatus!=="NOT_SOLD_CONFIRMED"?<li>Esito della vendita non confermato.</li>:null}{!detail.marketObservation?.priceConflict&&detail.location?.manuallyVerified&&["SOLD_CONFIRMED","NOT_SOLD_CONFIRMED"].includes(property.saleStatus)?<li>Nessuna delle verifiche principali resta aperta.</li>:null}</ul></section>
    {indizi.length&&(detail.opportunity?.score??0)>0&&(context.view==="mercato"||context.view==="opportunita")?<section><h2>Motivi della segnalazione</h2>{context.view!=="opportunita"?<ul className="lr-case-reasons">{indizi.map(reason=><li key={reason}>{opportunityReasonLabel(reason)}</li>)}</ul>:<a href="#panoramica" className="lr-case-text-link">Rileggi i motivi della segnalazione</a>}<p className="lr-case-muted">Indice {formatNumber(detail.opportunity?.score??0)}/100. Ordina gli indizi, non misura una probabilità di vendita.</p>{detail.opportunity?.evidenceSummary.components?<details><summary>Come si compone l’indice</summary><ul className="lr-case-muted">{Object.entries(detail.opportunity.evidenceSummary.components as Record<string,unknown>).map(([k,v])=><li key={k}>{({observed_age:"Presenza osservata",price_drops:"Ribassi",price_reduction:"Entità del ribasso",relistings:"Ripubblicazioni",unsold_exit:"Uscita senza vendita",agency_change:"Cambio agenzia",pending_exit:"Uscita da verificare",agency_to_private:"Passaggio a privato"} as Record<string,string>)[k]??humanize(k)}: {String(v)}</li>)}</ul></details>:null}</section>:null}
    <section><h2>Ultimi eventi {detail.historyPage&&detail.historyPage>1?"in questa pagina":""}</h2>{recentEvents.length?<ol className="lr-case-events">{recentEvents.slice(0,5).map(e=><li key={e.id}><time>{formatDate(e.occurredAt)}</time><p>{lifecycleEventLabel(e.eventType)}</p><span>{e.actorType==="ADAPTER"?"Letto dalla fonte":e.actorType==="USER"?"Registrato manualmente":"Dedotto dal sistema"}</span></li>)}</ol>:<p className="lr-case-muted">Nessun cambiamento di mercato in questa pagina dello storico.</p>}<a href="#storico" className="lr-case-text-link">Tutto lo storico e le prove</a></section>
    <section><h2>Fonti</h2>{detail.marketObservation?.agentName?<p className="lr-case-muted">Agente dichiarato: {detail.marketObservation.agentName}</p>:null}<ul className="lr-case-sources">{detail.publications.map(pub=><li key={pub.id}><a href={pub.canonicalUrl} target="_blank" rel="noreferrer">{pub.agencyName||getSourceLabel(pub.sourceKey)} ↗</a><span>Vista {formatDate(pub.lastSeenAt)}</span></li>)}{detail.privatePublications.map(pub=><li key={pub.id}><a href={pub.canonicalUrl} target="_blank" rel="noreferrer">{getSourceLabel(pub.source)} ↗</a><span>Vista {formatDate(pub.lastSeenAt)}</span></li>)}</ul></section>
    <nav className="lr-case-section-links" aria-label="Sezioni del dossier"><a href="#prezzi">Storico prezzi</a><a href="#pubblicazioni">Pubblicazioni</a>{detail.location&&forma!=="niente"?<a href="#territorio">Posizione</a>:null}<a href="#eventi-pubblici">Trasformazioni</a><a href="#documenti">Documenti pubblici</a></nav>
   </aside>
  </div>
 </div>;
}
