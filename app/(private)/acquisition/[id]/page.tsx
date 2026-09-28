import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { utcToRomeLocalInput } from "@/lib/acquisition/time";
import { addActivityAction,attachContactAction,bookAcquisitionAction,completeAcquisitionAction,linkPropertyAction,reviewContactAction,updateLeadAction,verifySignalAction } from "../actions";

export const dynamic = "force-dynamic";
const states = ["NEW","VERIFY","TO_CONTACT","CONTACTED","CONVERSATION","FOLLOW_UP",
  "ACQUISITION_BOOKED","ACQUISITION_DONE","WON","FUTURE","NOT_INTERESTED","LOST"];
const activityTypes = ["phone_call","whatsapp","sms","email","in_person","zone_visit",
  "verification","note"];
export default async function LeadPage({params}:{params:Promise<{id:string}>}) {
  const {id} = await params;
  const db = getSupabaseServiceClient();
  const [leadResult, signalsResult,activitiesResult,appointmentsResult,requestsResult] = await Promise.all([
    db.from("acquisition_leads").select("*,acquisition_contacts(*)").eq("id",id).maybeSingle(),
    db.from("acquisition_signals").select("*").eq("lead_id",id).order("observed_at",{ascending:false}).limit(100),
    db.from("acquisition_activities").select("*").eq("lead_id",id).order("occurred_at",{ascending:false}).limit(100),
    db.from("acquisition_appointments").select("*").eq("lead_id",id).order("scheduled_at",{ascending:false}).limit(20),
    db.from("acquisition_lead_requests").select("request_id").eq("lead_id",id).limit(100),
  ]);
  for (const result of [leadResult,signalsResult,activitiesResult,appointmentsResult,requestsResult])
    if (result.error) throw new Error(`Scheda acquisizione: ${result.error.message}`);
  const lead = leadResult.data;
  if (!lead) notFound();
  const contact = lead.acquisition_contacts;
  const requestIds = [...new Set([...(lead.request_id ? [lead.request_id] : []),
    ...(requestsResult.data ?? []).map(row=>row.request_id)])];
  const openAppointment = appointmentsResult.data?.find(x=>!x.completed_at);
  return <main className="space-y-6 p-4 md:p-6"><Link href="/acquisition" className="underline">Notizie</Link>
    <header><h1 className="text-2xl font-semibold">{lead.address}</h1><p>{lead.locality} · {lead.source_type} · {lead.status}</p>
      {lead.property_id && <Link href={`/lifecycle/archive/${lead.property_id}`} className="underline">Immobile V2</Link>}
      {requestIds.map((requestId,index)=><Link key={requestId} href={`/requests/${requestId}`}
        className="ml-3 underline">Richiesta buyer {index+1}</Link>)}
      {lead.possible_duplicate_of && <p>Possibile duplicato: <Link href={`/acquisition/${lead.possible_duplicate_of}`} className="underline">confronta</Link></p>}
    </header>
    {!lead.property_id && <form action={linkPropertyAction.bind(null,id)} className="rounded border p-4">
      <label>Collega immobile V2 per ID<input required name="property_id" className="ml-2 border p-2" /></label>
      <button className="ml-2 border p-2">Collega</button></form>}
    {contact && <section className="rounded border p-4"><h2 className="font-semibold">Contatto</h2>
      <p>{contact.full_name} · {contact.phone ?? "Senza telefono"}</p>
      {contact.possible_duplicate_of && <p>Possibile contatto duplicato: verifica il recapito prima di procedere.</p>}
      {(contact.do_not_contact || contact.contact_review_required || contact.contact_status === "blocked") &&
        <p className="font-semibold">Contatto bloccato o da rivedere</p>}
      <form action={reviewContactAction.bind(null,id)} className="flex flex-wrap gap-3">
        <select name="contact_status" defaultValue={contact.contact_status} className="border p-2">
          {["unreviewed","reviewed","consented","blocked"].map(x=><option key={x}>{x}</option>)}</select>
        <label><input type="checkbox" name="contact_review_required" defaultChecked={contact.contact_review_required} /> Revisione necessaria</label>
        <label>Rivedere dal <input type="datetime-local" name="contact_review_at"
          defaultValue={contact.contact_review_at ? utcToRomeLocalInput(contact.contact_review_at) : ""} className="border p-1" /></label>
        <label><input type="checkbox" name="do_not_contact" defaultChecked={contact.do_not_contact} /> Non contattare</label>
        <button className="border p-2">Salva verifica contatto</button>
      </form></section>}
    {!contact && <form action={attachContactAction.bind(null,id)} className="grid gap-2 rounded border p-4 md:grid-cols-3">
      <h2 className="font-semibold md:col-span-3">Collega un contatto identificato</h2>
      <input required name="full_name" placeholder="Nome" className="border p-2" />
      <input name="phone" placeholder="Telefono" className="border p-2" />
      <input name="email" type="email" placeholder="Email" className="border p-2" />
      <select name="role" className="border p-2"><option value="owner">Proprietario</option>
        <option value="administrator">Amministratore</option><option value="technician">Tecnico</option>
        <option value="professional">Professionista</option><option value="other">Altro</option></select>
      <input name="studio" placeholder="Studio" className="border p-2" />
      <input name="zones" placeholder="Zone note" className="border p-2" />
      <input name="client_id" placeholder="ID cliente CRM, se presente" className="border p-2" />
      <button className="border p-2 md:col-span-2">Collega contatto</button>
    </form>}
    <form action={updateLeadAction.bind(null,id)} className="grid gap-3 rounded border p-4 md:grid-cols-3">
      <h2 className="font-semibold md:col-span-3">Funnel e prossima azione</h2>
      <label>Stato<select name="status" defaultValue={lead.status} className="block w-full border p-2">
        {states.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Priorità<select name="priority" defaultValue={lead.priority} className="block w-full border p-2">
        {["A","B","C"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Tipo azione<input name="next_action_type" defaultValue={lead.next_action_type ?? ""} className="block w-full border p-2" /></label>
      <label>Quando<input type="datetime-local" name="next_action_at" defaultValue={lead.next_action_at ? utcToRomeLocalInput(lead.next_action_at) : ""} className="block w-full border p-2" /></label>
      <label className="md:col-span-2">Nota<input name="next_action_note" defaultValue={lead.next_action_note ?? ""} className="block w-full border p-2" /></label>
      <button className="rounded bg-black px-4 py-2 text-white md:col-span-3">Salva</button>
    </form>
    <form action={addActivityAction.bind(null,id)} className="grid gap-3 rounded border p-4 md:grid-cols-3">
      <h2 className="font-semibold md:col-span-3">Registra attività</h2>
      <select name="activity_type" className="border p-2">{activityTypes.map(x=><option key={x}>{x}</option>)}</select>
      <select name="outcome" className="border p-2">
        <option value="">Esito</option><option value="attempted">Tentativo</option>
        <option value="no_answer">Nessuna risposta</option><option value="conversation">Conversazione</option>
        <option value="follow_up_done">Follow-up svolto</option><option value="verified">Verificato</option>
        <option value="not_interested">Non interessato</option>
      </select>
      <input name="note" placeholder="Nota" className="border p-2" />
      <input name="next_action_type" placeholder="Prossima azione" className="border p-2" />
      <input name="next_action_at" type="datetime-local" className="border p-2" />
      <button className="rounded border p-2">Registra</button>
    </form>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Acquisizione</h2>
      <form action={bookAcquisitionAction.bind(null,id)} className="grid gap-2 rounded border p-4 md:grid-cols-3">
        <label>Appuntamento<input required type="datetime-local" name="scheduled_at" className="block w-full border p-2" /></label>
        <input name="motivation" placeholder="Motivazione vendita" className="border p-2" />
        <input name="selling_timing" placeholder="Tempi" className="border p-2" />
        <input name="asking_price" type="number" min="0" placeholder="Prezzo richiesto" className="border p-2" />
        <input name="estimated_price" type="number" min="0" placeholder="Stima" className="border p-2" />
        <input name="obstacles" placeholder="Ostacoli" className="border p-2" />
        <input name="competitors" placeholder="Altre agenzie" className="border p-2" />
        <button className="rounded border p-2 md:col-span-2">Fissa acquisizione</button>
      </form>
      {openAppointment && <form action={completeAcquisitionAction.bind(null,id)} className="grid gap-2 rounded border p-4 md:grid-cols-3">
        <p className="md:col-span-3">Appuntamento: {new Date(openAppointment.scheduled_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})}</p>
        <select name="outcome" className="border p-2">{["mandate","follow_up","not_ready","lost","reconsider"].map(x=><option key={x}>{x}</option>)}</select>
        <input name="next_action_type" placeholder="Prossima azione" className="border p-2" />
        <input type="datetime-local" name="next_action_at" className="border p-2" />
        <input name="note" placeholder="Nota esito" className="border p-2 md:col-span-2" />
        <button className="rounded border p-2">Registra esito</button>
      </form>}
    </section>
    <section><h2 className="text-lg font-semibold">Notizie</h2>{signalsResult.data?.map(x=><div key={x.id} className="border-b py-2">
      {new Date(x.observed_at).toLocaleDateString("it-IT",{timeZone:"Europe/Rome"})} · {x.signal_type} · {x.source_type} · {x.description}
      <form action={verifySignalAction.bind(null,id,x.id)} className="ml-3 inline-flex gap-2">
        <select name="verification_status" defaultValue={x.verification_status} className="border p-1">
          {["unverified","verified","rejected"].map(s=><option key={s}>{s}</option>)}</select>
        <button className="border p-1">Salva</button></form></div>)}</section>
    <section><h2 className="text-lg font-semibold">Timeline</h2>{activitiesResult.data?.map(x=><p key={x.id} className="border-b py-2">
      {new Date(x.occurred_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})} · {x.activity_type} · {x.outcome} · {x.note}</p>)}</section>
  </main>;
}
