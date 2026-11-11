import {getSupabaseServiceClient} from "@/lib/supabase/service";

export async function ArchiveFreshness(){
 const {data,error}=await getSupabaseServiceClient().from("radar_read_model_state")
  .select("source_revision,refreshed_revision,refreshed_at,last_error").single();
 if(error||!data)return null;
 const pending=data.source_revision!==data.refreshed_revision;
 return <p className="py-2 text-sm text-[var(--lr-ink-3)]">
  Archivio aggiornato il <time dateTime={data.refreshed_at}>{new Date(data.refreshed_at).toLocaleString("it-IT",{timeZone:"Europe/Rome",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</time>
  {data.last_error?" · Aggiornamento da riprovare; resta disponibile l’ultima versione completa.":pending?" · Nuovi dati in elaborazione; stai consultando l’ultima versione completa.":null}
 </p>;
}
