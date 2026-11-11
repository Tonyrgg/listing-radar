import {getSupabaseServiceClient} from "@/lib/supabase/service";
import {getSourcesSummary} from '@/lib/sources-health';
import Link from 'next/link';

export async function ArchiveFreshness(){
 const [{data,error},sources]=await Promise.all([getSupabaseServiceClient().from("radar_read_model_state")
  .select("source_revision,refreshed_revision,refreshed_at,last_error").single(), getSourcesSummary()]);
 const pending=data && data.source_revision!==data.refreshed_revision;
 const issues=[...sources.broken,...sources.partial];
 return <div className="py-2 text-sm text-[var(--lr-ink-3)]">
  {!error && data ? <p>Vista dell’archivio elaborata il <time dateTime={data.refreshed_at}>{new Date(data.refreshed_at).toLocaleString("it-IT",{timeZone:"Europe/Rome",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</time>
  {data.last_error?" · Aggiornamento da riprovare; resta disponibile l’ultima versione completa.":pending?" · Nuovi dati in elaborazione; stai consultando l’ultima versione completa.":null}
  </p> : null}
  {!sources.available ? <p>Stato delle letture non verificabile al momento. <Link className="underline" href="/fonti">Controlla le fonti</Link>.</p> : issues.length ?
    <details className="mt-1 text-[var(--lr-warn)]"><summary className="cursor-pointer">{issues.length} {issues.length===1?'fonte con lettura incompleta, non recente o non disponibile':'fonti con letture incomplete, non recenti o non disponibili'}</summary>
      <p className="mt-1">Gli ultimi dati raccolti restano consultabili; non attestano un aggiornamento completo del mercato.</p>
      <ul className="ml-4 list-disc">{issues.map(source=><li key={source.name}>{source.name}: {source.note || 'lettura da verificare'}</li>)}</ul>
      <Link className="underline" href="/fonti">Dettagli delle fonti</Link>
    </details> : <p>{sources.total > 0 ? 'Le letture delle agenzie risultano sane nelle ultime 24 ore. I dati restano quelli dichiarati dalle fonti.' : 'Nessuna fonte agenzia abilitata da verificare.'}</p>}
 </div>;
}
