import Link from "next/link";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
const pageSize = 50;

export default async function AcquisitionTodayPage({searchParams}: {
  searchParams: Promise<{page?: string}>;
}) {
  const requestedPage = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const db = getSupabaseServiceClient();
  const {data,error,count} = await db.from("acquisition_today_queue")
    .select("id,address,locality,status,priority,next_action_type,next_action_at,source_type,queue_rank",{count:"exact"})
    .order("queue_rank",{ascending:true})
    .order("next_action_at",{ascending:true,nullsFirst:false})
    .order("id",{ascending:true})
    .range((page-1)*pageSize,page*pageSize-1);
  if (error) throw new Error(`Coda Oggi: ${error.message}`);
  const pages = Math.max(1,Math.ceil((count ?? 0)/pageSize));
  return <main className="space-y-4 p-4 md:p-6"><Link href="/acquisition" className="underline">Notizie</Link>
    <h1 className="text-2xl font-semibold">Oggi · {count ?? 0} da lavorare</h1>
    <p>Appuntamenti, follow-up, lead A e opportunità senza prossima azione.</p>
    {(data ?? []).map(row=><Link href={`/acquisition/${row.id}`} key={row.id} className="block rounded border p-4">
      <strong>{row.address}</strong> · {row.locality} · {row.priority} · {row.status}<br />
      {row.next_action_at ? `${row.next_action_type ?? "Azione"} · ${new Date(row.next_action_at).toLocaleString("it-IT",{timeZone:"Europe/Rome"})}`
        : <strong>Imposta la prossima azione</strong>}
    </Link>)}
    <nav className="flex gap-4" aria-label="Pagine della coda">
      {page > 1 && <Link className="underline" href={`/acquisition/today?page=${page-1}`}>Precedente</Link>}
      <span>Pagina {page} di {pages}</span>
      {page < pages && <Link className="underline" href={`/acquisition/today?page=${page+1}`}>Successiva</Link>}
    </nav>
  </main>;
}
