import { requireUser } from '@/lib/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { readSellerCases } from '@/lib/seller-intake/repository';
import { SellerWorkbench, type SellerMetrics } from '@/components/seller-workbench';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Richieste e verifiche' };
export default async function SellerRequests({ searchParams }: { searchParams: Promise<{ closed?: string;page?:string }> }) {
  const user = await requireUser();
  if (!user) return <p>Accedi per consultare le richieste. In locale abilita AUTH_REQUIRED e usa un account di prova.</p>;
  const params=await searchParams, closed = params.closed === '1';
  let result, metrics;
  try {
    const db = await getSupabaseServerClient();
    result = await readSellerCases(db, user.id, closed,params.page);
    const r = await db.rpc('seller_workbench_metrics');
    if (r.error) throw r.error;
    metrics = r.data as SellerMetrics;
  }
  catch { return <main className="max-w-[72ch] space-y-4"><h1 className="text-[length:var(--lr-text-page)]">Richieste e verifiche</h1><p>Archivio non disponibile. Verifica le migration previste sul database locale di collaudo, poi ricarica.</p></main>; }
  return <SellerWorkbench items={result.items} metrics={metrics} closed={closed} pagination={result}/>;
}
