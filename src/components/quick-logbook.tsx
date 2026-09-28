import Link from "next/link";
import { createLogbookEntryAction } from "@/app/(private)/logbook/actions";

type Choice = {id:string;label:string};
export function QuickLogbook({leadId,contactId,clientId,propertyId,leads=[],contacts=[]}:{
  leadId?:string;contactId?:string;clientId?:string;propertyId?:string;
  leads?:Choice[];contacts?:Choice[];
}) {
  return <details className="rounded-md border border-[var(--lr-line)] bg-[var(--lr-surface)] p-3">
    <summary className="cursor-pointer font-semibold">+ Registra attività</summary>
    <form action={createLogbookEntryAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {leadId ? <input type="hidden" name="lead_id" value={leadId}/> :
        <label className="text-sm">Opportunità
          <select name="lead_id" defaultValue="" className="mt-1 w-full rounded border p-2">
            <option value="">Nessuna</option>
            {leads.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>}
      {contactId ? <input type="hidden" name="contact_id" value={contactId}/> :
        !leadId && <label className="text-sm">Persona
          <select name="contact_id" defaultValue="" className="mt-1 w-full rounded border p-2">
            <option value="">Nessuna</option>
            {contacts.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>}
      {propertyId && <input type="hidden" name="property_id" value={propertyId}/>}
      {clientId && <input type="hidden" name="client_id" value={clientId}/>}
      <label className="text-sm">Tipo
        <select name="event_type" defaultValue="note" className="mt-1 w-full rounded border p-2">
          <option value="note">Nota</option><option value="phone_call">Telefonata</option>
          <option value="whatsapp">WhatsApp registrato</option>
          <option value="in_person">Conversazione</option>
          <option value="zone_visit">Attività in zona</option>
          <option value="private_sign">Cartello</option>
          <option value="property_check">Verifica immobile</option>
          <option value="referral">Segnalazione</option>
        </select>
      </label>
      <label className="text-sm">Esito
        <select name="outcome" defaultValue="" className="mt-1 w-full rounded border p-2">
          <option value="">—</option><option value="attempted">Tentativo</option>
          <option value="no_answer">Nessuna risposta</option>
          <option value="conversation">Conversazione</option>
          <option value="follow_up_done">Follow-up eseguito</option>
        </select>
      </label>
      <label className="text-sm sm:col-span-2">Nota
        <textarea name="note" rows={2} className="mt-1 w-full rounded border p-2"/>
      </label>
      <label className="text-sm">Prossima azione
        <input name="next_action_type" className="mt-1 w-full rounded border p-2"/>
      </label>
      <label className="text-sm">Quando
        <input name="next_action_at" type="datetime-local" className="mt-1 w-full rounded border p-2"/>
      </label>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
        <button className="rounded bg-[var(--lr-ink)] px-4 py-2 text-sm font-semibold text-white">
          Registra
        </button>
        <Link href="/acquisition" className="text-sm underline">+ Notizia o cartello dettagliato</Link>
      </div>
    </form>
  </details>;
}
