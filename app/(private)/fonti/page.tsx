import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { LifecycleSectionNav } from "@/components/lifecycle-section-nav";
import { PageHeader } from "@/components/page-header";
import { Card, Chip, EmptyState, Label, Meta, Stripe, buttonClass } from "@/components/ui/primitives";
import { Fonte } from "@/components/ui/atoms";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { vistaAgenzie } from "@/lib/property-lifecycle/read-models/server";
import type { SourceHealth } from "@/components/ui/atoms";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readExternalSourceStatus } from "@/lib/property-lifecycle/read-models/external";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fonti" };

function classifica(health: string | null, sync: string | null): SourceHealth {
  const value = String(health ?? "").toUpperCase();
  if (value === "FAILED" || value === "STRUCTURE_CHANGED") return "broken";
  if (value === "DEGRADED") return "partial";
  if (value === "HEALTHY") return "healthy";
  return sync ? "partial" : "unknown";
}

const spiegazione: Record<string, string> = {
  STRUCTURE_CHANGED: "il sito ha cambiato struttura: i selettori non trovano più gli annunci",
  FAILED: "non ha risposto all'ultimo giro",
  DEGRADED: "ha risposto solo in parte",
  HEALTHY: "letta per intero",
};

const etichetta: Record<SourceHealth, string> = {
  healthy: "Letta",
  partial: "Parziale",
  broken: "Non letta",
  unknown: "Mai letta",
};

const tono: Record<SourceHealth, "action" | "warn" | "danger" | "neutral"> = {
  healthy: "action",
  partial: "warn",
  broken: "danger",
  unknown: "neutral",
};

export default async function FontiPage() {
  await connection();

  const [vista, external, recentRuns, municipalRuns] = await Promise.all([
    vistaAgenzie(),
    Promise.resolve().then(() => readExternalSourceStatus(getSupabaseServiceClient())).catch(() => null),
    getSupabaseServiceClient().from("sync_runs").select("agency_id,health_state,diagnostics,absence_evaluation_allowed,inventory_complete").order("started_at",{ascending:false}).limit(100),
    getSupabaseServiceClient().from("building_data_import_runs").select("source_key,status,finished_at,grouped_records,errors,health_state,pages,inventory_complete,structure_fingerprint,diagnostics").order("started_at",{ascending:false}).limit(30),
  ]);

  if (!vista.available || !vista.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Le fonti"
          description="Di chi ci si può fidare stamattina."
          backHref="/intelligence"
          backLabel="Torna all’archivio"
        />
        <Card>
          <EmptyState
            title="Le fonti non sono raggiungibili"
            description="Questa pagina lavora sull'archivio dei segnali, che al momento non risponde. Il resto del programma funziona normalmente."
          />
        </Card>
      </div>
    );
  }

  const agenzie = [...vista.data]
    .filter((agency) => agency.enabled)
    .map((agency) => ({
      ...agency,
      salute: classifica(agency.latestHealth, agency.latestSyncStatus),
    }))
    .sort((left, right) => {
      const ordine: Record<SourceHealth, number> = {
        broken: 0,
        partial: 1,
        unknown: 2,
        healthy: 3,
      };

      if (ordine[left.salute] !== ordine[right.salute]) {
        return ordine[left.salute] - ordine[right.salute];
      }

      return (right.latestSyncCounts?.inScope ?? 0) - (left.latestSyncCounts?.inScope ?? 0);
    });

  const massimo = Math.max(
    1,
    ...agenzie.map((agency) => agency.latestSyncCounts?.inScope ?? 0),
  );
  const lette = agenzie.filter((agency) => agency.salute === "healthy").length;
  const latest=new Map<string,{diagnostics:Record<string,unknown>;absence_evaluation_allowed:boolean;inventory_complete:boolean}>();
  for(const run of recentRuns.data??[])if(!latest.has(run.agency_id))latest.set(run.agency_id,run);
  const municipal=new Map<string,NonNullable<typeof municipalRuns.data>[number]>();
  for(const run of municipalRuns.data??[])if(!municipal.has(run.source_key))municipal.set(run.source_key,run);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fonti"
        description="Ultima sincronizzazione, copertura e problemi delle fonti. Le letture fallite non autorizzano scomparse."
        actions={
          <Chip tone={lette === agenzie.length ? "action" : "warn"} dot>
            {lette} su {agenzie.length} lette per intero
          </Chip>
        }
        nav={<LifecycleSectionNav />}
      />

      {/* La regola non negoziabile del progetto, scritta dove serve. */}
      {external ? <Card className="p-4"><h2 className="font-[650]">Prove dalle fonti esterne</h2><Meta>In questa fase i portali non autorizzano assenze. Una verifica puntuale non dimostra un inventario completo.</Meta><div className="mt-3 divide-y divide-[var(--lr-line-quiet)]">{external.map(source=><div key={source.key} className="flex flex-wrap justify-between gap-2 py-3"><strong>{({WIKICASA:"Wikicasa",IMMOBILIARE:"Immobiliare.it",CASA:"Casa.it",IDEALISTA:"Idealista",SEARCH_INDEX:"Indice storico"} as Record<string,string>)[source.key] ?? source.key}</strong><div className="text-[length:var(--lr-text-meta)]"><p>{!source.enabled ? "Disattivata" : source.state==="FAILED" ? "Non letta" : source.state==="DEGRADED" ? "Lettura parziale" : source.state==="RUNNING" ? "Lettura in corso" : source.inventoryComplete ? "Inventario completo nello scope configurato" : source.state ? "Verifica puntuale" : "In attesa del primo run"} · {source.projectionsEnabled ? "Prove usate nell’intelligence" : "Prove in valutazione"}</p><Meta>{source.finishedAt ? `Ultimo run ${formatDateTime(source.finishedAt)} · ` : ""}{source.discovered} annunci · {source.details} dettagli richiesti{source.key==="WIKICASA" ? ` · ${source.baselineReady ? "baseline pronta" : "baseline da verificare"}` : ""}</Meta></div></div>)}</div></Card> : null}
      {agenzie.some(a=>a.salute==="broken") ? (
        <Card className="p-4">
          <div className="flex gap-3">
            <Stripe tone="danger" />
            <div className="min-w-0">
              <Label tone="danger">Cosa NON significa</Label>
              <p className="mt-1.5 max-w-prose text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                Gli immobili delle fonti non lette <strong>non sono spariti</strong>: restano
                come li abbiamo visti l&apos;ultima volta. Un crawler fermo non prova la
                scomparsa di un annuncio, e non autorizza nuove assenze.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="border-b border-[var(--lr-line-quiet)] px-4 py-3">
          <Label>Ultimo giro</Label>
          <h2 className="mt-1 text-[length:var(--lr-text-section)] font-[650] tracking-[var(--lr-tracking-title)] text-[var(--lr-ink)]">
            {agenzie.length} agenzie osservate
          </h2>
        </div>

        <div>
          {agenzie.map((agency) => {
            const letti = agency.latestSyncCounts?.inScope ?? 0;
            const esclusi = agency.latestSyncCounts?.excluded ?? 0;
            /* Una fonte «letta per intero» che non riporta nemmeno un immobile
             * pur avendone in inventario è il caso silenzioso che conta di più:
             * tecnicamente sana, in pratica cieca. Si dice, non si nasconde. */
            const cieca = agency.salute === "healthy" && letti === 0 && agency.activeCount > 0;
            const nota = cieca
              ? "risponde, ma non ha restituito nessun immobile"
              : spiegazione[String(agency.latestHealth ?? "").toUpperCase()];
            const run=latest.get(agency.id),diagnostics=run?.diagnostics??{};
            const inventory=diagnostics.inventory as {reasons?:string[]}|undefined;
            const problems=typeof diagnostics.error==="string"?diagnostics.error:(inventory?.reasons??[]).filter(r=>/http_status|error|failed|missing|mismatch/i.test(r)).join(" · ");

            return (
              <div
                key={agency.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--lr-line-quiet)] px-4 py-3 first:border-t-0"
              >
                <div className="min-w-48 flex-1">
                  <p className="text-[length:var(--lr-text-record)] font-[650] text-[var(--lr-ink)]">
                    <Fonte name={agency.name} health={cieca ? "partial" : agency.salute} />
                  </p>
                  <Meta className="mt-0.5">
                    {nota ?? "stato non noto"}
                    {esclusi ? ` · ${formatNumber(esclusi)} fuori perimetro` : ""}
                  </Meta>
                  {problems?<p className="mt-1 break-words text-[length:var(--lr-text-meta)] text-[var(--lr-danger)]">Ultimo problema: {problems}</p>:null}
                  {run?<Meta>{run.inventory_complete?"Inventario completo":"Inventario incompleto"} · {run.absence_evaluation_allowed?"Controllo assenze autorizzato dalla baseline":"Nessuna nuova assenza autorizzata"}</Meta>:null}
                </div>

                {/* Una barra per fonte: piena se letta tutta, vuota se rotta. */}
                <div className="w-40 shrink-0">
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-[var(--lr-raised)]"
                    role="img"
                    aria-label={`${formatNumber(letti)} immobili letti`}
                  >
                    <div
                      className={
                        agency.salute === "broken"
                          ? "h-full rounded-full bg-[var(--lr-danger)] opacity-40"
                          : agency.salute === "partial"
                            ? "h-full rounded-full bg-[var(--lr-warn)]"
                            : "h-full rounded-full bg-[var(--lr-ok)]"
                      }
                      style={{
                        width: `${agency.salute === "broken" ? 100 : Math.max(4, Math.round((letti / massimo) * 100))}%`,
                      }}
                    />
                  </div>
                  <Meta className="mt-1">
                    {agency.salute === "broken"
                      ? letti
                        ? `${formatNumber(letti)} non riletti oggi`
                        : "non riletta oggi"
                      : `${formatNumber(letti)} immobili`}
                  </Meta>
                </div>

                {/* Cosa tiene, non solo se l'abbiamo letta: prima queste tre
                  * cifre stavano in una seconda pagina con le stesse dieci righe. */}
                <div className="w-40 shrink-0">
                  <p className="text-[length:var(--lr-text-body)] text-[var(--lr-ink-2)]">
                    <b className="font-[650] text-[var(--lr-ink)]">
                      {formatNumber(agency.activeCount)}
                    </b>{" "}
                    in vendita
                  </p>
                  <Meta className="mt-0.5">
                    {formatNumber(agency.exitedCount)} uscite ·{" "}
                    {formatNumber(agency.soldCount)} vendute
                  </Meta>
                </div>

                <div className="w-32 shrink-0">
                  <Chip tone={cieca ? "warn" : tono[agency.salute]} dot>
                    {cieca ? "Vuota" : etichetta[agency.salute]}
                  </Chip>
                  <Meta className="mt-1">
                    {agency.latestSyncAt ? formatDateTime(agency.latestSyncAt) : "mai"}
                  </Meta>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/lifecycle/agencies/${agency.slug}`}
                    className={buttonClass("secondary", { compact: true })}
                  >
                    Vedi cosa tiene
                  </Link>
                  {agency.websiteUrl ? (
                    <a
                      href={agency.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Apri il sito di ${agency.name}`}
                      title={`Apri il sito di ${agency.name}`}
                      className={buttonClass("quiet", { compact: true, icon: true })}
                    >
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <section className="border-t border-[var(--lr-line-quiet)] pt-4">
        <h2 className="text-[length:var(--lr-text-section)] font-[650]">Fonti territoriali pubbliche</h2>
        <div className="mt-2 divide-y divide-[var(--lr-line-quiet)]">{[...municipal.values()].map(run=><div key={run.source_key} className="flex flex-wrap justify-between gap-3 py-3"><strong>{({"comune-bitonto-prg-catalog":"Comune · SIT / PRG","comune-bitonto-albo":"Comune · Albo Pretorio","comune-bitonto-elenco-pratiche-2025":"Comune · registro edilizio 2025, senza indirizzi"} as Record<string,string>)[run.source_key]??"Comune · registro edilizio 2024"}</strong><div><p>{run.status==="SUCCEEDED"?"Letta":run.status==="FAILED"?"Lettura fallita":run.status==="RUNNING"?"Lettura in corso":"Lettura parziale"} · {run.grouped_records} record{run.pages?` · ${run.pages} pagine`:""}</p><Meta>Ultimo completamento {run.finished_at?formatDateTime(run.finished_at):"non disponibile"}</Meta>{run.source_key==="comune-bitonto-albo"?<Meta>{run.inventory_complete?"Inventory completa delle pubblicazioni esposte":"Inventory non completata"} · PDF non scaricati automaticamente</Meta>:null}{Array.isArray(run.errors)&&run.errors.length?<Meta>Ultimo problema: {JSON.stringify(run.errors)}</Meta>:null}</div></div>)}</div>
        <Meta>Albo giornaliero; registri statici e catalogo a cadenza settimanale nello stesso scheduler. Nessuna rimozione dedotta da fetch falliti. Dataset 2023/2022/2021 non reperiti; non equivale a zero pratiche.</Meta>
        <Meta>SUE/SUAP: inventario pubblico non dimostrato. SIT: progetto QGIS pubblico verificato con 86 riferimenti a layer; servizio WMS non operativo nel controllo, nessuna geometria normativa assegnata. <a className="underline" href="https://sit.egov.ba.it/custom_static/html/wms-qgis/bitonto.qgs" target="_blank" rel="noreferrer">Progetto ufficiale</a></Meta>
      </section>

      <Meta className="px-1">
        Le fonti con limiti noti restano utili: quello che dichiarano è valido, ma la data
        d&apos;inizio o la posizione possono essere meno precise. Dove succede, il dato compare
        tratteggiato nelle schede.
      </Meta>
    </div>
  );
}
