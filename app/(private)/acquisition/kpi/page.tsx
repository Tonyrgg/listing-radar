import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readNow } from "@/lib/clock";

export const dynamic = "force-dynamic";
export const metadata = { title: "KPI acquisizioni" };
type KpiSnapshot = {
  metrics: {
    new_signals: number; verified_signals: number; new_leads: number;
    contact_attempts: number; conversations: number; followups_done: number;
    booked: number; completed: number; mandates: number;
  };
  sources: {name: string; count: number}[];
  signal_types: {name: string; count: number}[];
  mandates_by_source: {name: string; count: number}[];
};
export default async function KpiPage({searchParams}:{searchParams:Promise<{days?:string}>}) {
  const {days} = await searchParams;
  const period = days === "7" ? 7 : days === "90" ? 90 : 30;
  const since = new Date((await readNow())-period*86400000).toISOString();
  const db = getSupabaseServiceClient();
  const {data,error} = await db.rpc("acquisition_kpis",{p_since:since});
  if (error || !data) throw new Error(`KPI: ${error?.message ?? "risposta vuota"}`);
  const snapshot = data as KpiSnapshot;
  const {metrics: kpi} = snapshot;
  const metrics = [
    ["Nuove notizie",kpi.new_signals],
    ["Notizie verificate",kpi.verified_signals],
    ["Nuovi lead",kpi.new_leads],
    ["Tentativi di contatto",kpi.contact_attempts],
    ["Conversazioni",kpi.conversations],
    ["Follow-up eseguiti",kpi.followups_done],
    ["Acquisizioni fissate",kpi.booked],
    ["Acquisizioni svolte",kpi.completed],
    ["Incarichi",kpi.mandates],
  ] as const;
  const verified = metrics[1][1], contacts = metrics[3][1], conversations = metrics[4][1];
  const booked = metrics[6][1], completed = metrics[7][1], mandates = metrics[8][1];
  const rate = (part:number,total:number) => total ? `${Math.round(part / total * 100)}%` : "—";
  return <main className="space-y-4 p-4 md:p-6"><Link href="/acquisition" className="underline">Notizie</Link>
    <h1 className="text-2xl font-semibold">KPI · ultimi {period} giorni</h1>
    <nav className="flex gap-3 underline"><Link href="?days=7">7 giorni</Link><Link href="?days=30">30 giorni</Link><Link href="?days=90">90 giorni</Link></nav>
    <div className="grid gap-3 md:grid-cols-3">{metrics.map(([label,n])=><div key={label} className="rounded border p-4">
      <strong className="text-2xl">{n}</strong><p>{label}</p></div>)}</div>
    <p>Verificate/notizie {rate(verified,metrics[0][1])} · Tentativi/verificate {rate(contacts,verified)} ·
      Conversazioni/tentativi {rate(conversations,contacts)} · Acquisizioni/conversazioni {rate(booked,conversations)} ·
      Incarichi/acquisizioni svolte {rate(mandates,completed)}</p>
    <h2 className="text-lg font-semibold">Notizie per fonte</h2>
    {snapshot.sources.map(({name,count})=><p key={name}>{name}: {count}</p>)}
    <h2 className="text-lg font-semibold">Notizie per tipo</h2>
    {snapshot.signal_types.map(({name,count})=><p key={name}>{name}: {count}</p>)}
    <h2 className="text-lg font-semibold">Incarichi per fonte iniziale</h2>
    {snapshot.mandates_by_source.map(({name,count})=><p key={name}>{name}: {count}</p>)}
  </main>;
}
