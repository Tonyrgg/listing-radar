import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createSignalAction } from "./actions";

export const dynamic = "force-dynamic";
const engines = ["fsbo_radar","crm_mining","buyer_to_seller","abandoned_property",
  "building_event","smart_zone","professional_network","neighborhood_intelligence",
  "property_intelligence","succession","private_sign","condominium_works","moving",
  "administrators","technicians"];

export default async function AcquisitionPage() {
  const db = getSupabaseServiceClient();
  const {data: leads,error} = await db.from("acquisition_leads")
    .select("id,address,locality,status,priority,source_type,next_action_at,possible_duplicate_of")
    .order("created_at",{ascending:false}).limit(100);
  if (error) throw new Error(`Notizie: ${error.message}`);
  return <main className="space-y-6 p-4 md:p-6">
    <header><h1 className="text-2xl font-semibold">Notizie e acquisizioni</h1>
      <p>Raccogli una notizia, verificala e programma il prossimo passo.</p>
      <nav className="flex gap-4 underline"><Link href="/acquisition/today">Coda Oggi</Link>
        <Link href="/acquisition/zone">Zona</Link><Link href="/acquisition/kpi">KPI</Link></nav></header>
    <form action={createSignalAction} className="grid gap-3 rounded border p-4 md:grid-cols-3">
      <h2 className="text-lg font-semibold md:col-span-3">Quick Add</h2>
      <label>Indirizzo<input required name="address" className="block w-full rounded border p-2" /></label>
      <label>Località<select name="locality" className="block w-full rounded border p-2">
        {["Bitonto","Palombaio","Mariotto"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Motore<select name="source_type" className="block w-full rounded border p-2">
        {engines.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></label>
      <label>Segnale<input required name="signal_type" placeholder="Es. cartello vendesi" className="block w-full rounded border p-2" /></label>
      <label>Riferimento fonte<input name="source_reference" placeholder="Persona, sito o documento" className="block w-full rounded border p-2" /></label>
      <label>Data rilevamento<input type="datetime-local" name="observed_at" className="block w-full rounded border p-2" /></label>
      <label>Priorità<select name="priority" defaultValue="C" className="block w-full rounded border p-2">
        <option value="A">A — oggi</option><option value="B">B — 72 ore</option><option value="C">C — monitoraggio</option>
      </select></label>
      <label>Contatto<input name="contact_name" className="block w-full rounded border p-2" /></label>
      <label>Telefono<input name="contact_phone" className="block w-full rounded border p-2" /></label>
      <fieldset className="grid gap-2 border p-2 md:col-span-3"><legend>Cartello privato (se pertinente)</legend>
        <label>Tipo<select name="sign_type" className="ml-2 border p-2"><option value="">—</option><option>Vendesi</option><option>Affittasi</option></select></label>
        <label>Ancora presente<select name="still_present" className="ml-2 border p-2"><option value="unknown">Da verificare</option><option value="yes">Sì</option><option value="no">No</option></select></label>
        <label>Ultimo controllo<input type="datetime-local" name="last_checked_at" className="ml-2 border p-2" /></label>
      </fieldset>
      <label>Prossima azione<input name="next_action_type" className="block w-full rounded border p-2" /></label>
      <label>Quando<input type="datetime-local" name="next_action_at" className="block w-full rounded border p-2" /></label>
      <label className="md:col-span-3">Nota<textarea name="note" className="block w-full rounded border p-2" /></label>
      <button className="rounded bg-black px-4 py-2 text-white md:col-span-3">Registra notizia</button>
    </form>
    <section><h2 className="mb-3 text-lg font-semibold">Pipeline recente</h2>
      <div className="space-y-2">{leads?.map(lead=><Link key={lead.id} href={`/acquisition/${lead.id}`}
        className="block rounded border p-3 hover:bg-gray-50"><strong>{lead.address}</strong> · {lead.locality}
        <span className="ml-3">{lead.status} · {lead.priority} · {lead.source_type}</span>
        {lead.possible_duplicate_of && <span className="ml-3">Possibile duplicato</span>}
        {!lead.next_action_at && !["WON","FUTURE","NOT_INTERESTED","LOST"].includes(lead.status) &&
          <span className="ml-3 font-semibold">Senza prossima azione</span>}</Link>)}</div>
    </section>
  </main>;
}
