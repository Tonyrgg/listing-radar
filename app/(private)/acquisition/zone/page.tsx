import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zona acquisizioni" };
export default async function ZonePage({searchParams}: {searchParams: Promise<{locality?:string; street?:string; priority?:string; status?:string; signal?:string; to_verify?:string; follow_up?:string}>}) {
  const filters = await searchParams;
  const db = getSupabaseServiceClient();
  let query = db.from("acquisition_leads").select("id,address,locality,status,priority,next_action_type,next_action_at")
    .not("status","in","(WON,FUTURE,NOT_INTERESTED,LOST)").limit(100);
  if (["Bitonto","Palombaio","Mariotto"].includes(filters.locality ?? "")) query = query.eq("locality",filters.locality!);
  if (filters.street) query = query.ilike("address",`%${filters.street.slice(0,80)}%`);
  if (["A","B","C"].includes(filters.priority ?? "")) query = query.eq("priority",filters.priority!);
  if (["NEW","VERIFY","TO_CONTACT","CONTACTED","CONVERSATION","FOLLOW_UP","ACQUISITION_BOOKED","ACQUISITION_DONE"].includes(filters.status ?? ""))
    query = query.eq("status",filters.status!);
  if (filters.follow_up === "1") query = query.eq("status","FOLLOW_UP");
  if (filters.to_verify === "1") query = query.in("status",["NEW","VERIFY"]);
  if (filters.signal) {
    const signals = await db.from("acquisition_signals").select("lead_id")
      .eq("signal_type",filters.signal.slice(0,100)).limit(1000);
    if (signals.error) throw new Error(`Filtro segnali: ${signals.error.message}`);
    const ids = [...new Set((signals.data ?? []).map(x=>x.lead_id))];
    if (ids.length === 0) return <main className="p-4"><Link href="/acquisition/zone">Zona</Link><p>Nessun segnale trovato.</p></main>;
    query = query.in("id",ids);
  }
  const {data,error} = await query;
  if (error) throw new Error(`Zona: ${error.message}`);
  return <main className="space-y-4 p-4 md:p-6"><Link href="/acquisition" className="underline">Notizie</Link>
    <h1 className="text-2xl font-semibold">Zona</h1>
    <form className="flex flex-wrap gap-2"><select name="locality" defaultValue={filters.locality ?? ""} className="border p-2">
      <option value="">Tutte le zone</option>{["Bitonto","Palombaio","Mariotto"].map(x=><option key={x}>{x}</option>)}
    </select><input name="street" placeholder="Via" defaultValue={filters.street} className="border p-2" />
      <select name="priority" defaultValue={filters.priority ?? ""} className="border p-2"><option value="">Tutte le priorità</option>
        {["A","B","C"].map(x=><option key={x}>{x}</option>)}</select>
      <select name="status" defaultValue={filters.status ?? ""} className="border p-2"><option value="">Tutti gli stati</option>
        {["NEW","VERIFY","TO_CONTACT","CONTACTED","CONVERSATION","FOLLOW_UP","ACQUISITION_BOOKED","ACQUISITION_DONE"].map(x=><option key={x}>{x}</option>)}</select>
      <input name="signal" placeholder="Tipo segnale" defaultValue={filters.signal} className="border p-2" />
      <label><input type="checkbox" name="to_verify" value="1" defaultChecked={filters.to_verify === "1"} /> Da verificare</label>
      <label><input type="checkbox" name="follow_up" value="1" defaultChecked={filters.follow_up === "1"} /> Follow-up</label>
      <button className="border p-2">Filtra</button></form>
    {data?.map(row=><Link href={`/acquisition/${row.id}`} key={row.id} className="block rounded border p-3">
      <strong>{row.address}</strong> · {row.locality} · {row.status} · {row.priority}<br />
      {row.next_action_type ?? "Da verificare"} {row.next_action_at && new Date(row.next_action_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})}
    </Link>)}
  </main>;
}
