import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PropertyLifecycleRepository } from "@/lib/property-lifecycle/persistence/repository";
import { StudiSantiDetailIdentityError } from "@/lib/property-lifecycle/adapters/studisanti";
import { basePropertyLifecycleAdapter } from "@/lib/property-lifecycle/adapters/registry";
import { normalizedListingV2Schema, rehashNormalizedListing } from "@/lib/property-lifecycle/contracts/normalized-listing";
import { PRIVATE_PORTALS, privateObservationFromCapture, type PrivatePortal } from "@/lib/property-lifecycle/private-radar/collector";
import { PrivateRadarBridge } from "@/lib/property-lifecycle/private-radar/bridge";
import { OPEN_TAB_BATCH_BYTES, OPEN_TAB_MAX_BYTES, openTabIdentity, openTabSignature, openTabSource, type OpenTabOutcome } from "../../../../worker/src/agency-browser/open-tab-contract";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({ acquisitionId: z.uuid().optional(), captures: z.array(z.object({
  url: z.url().max(2000), capturedAt: z.iso.datetime(),
  html: z.string().max(OPEN_TAB_MAX_BYTES).optional(), fields: z.record(z.string(),z.unknown()).optional(),
})).min(1).max(6) });

function directObservationId(portal: string, id: string) {
  const hash=createHash("sha256").update(`open-tabs:${portal}:${id}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

export async function POST(request: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stamp = request.headers.get("x-worker-time") ?? "";
  const signature = request.headers.get("x-worker-signature") ?? "";
  if (!key || !/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 120_000 || !/^[0-9a-f]{64}$/.test(signature)) {
    return Response.json({ok:false},{status:401});
  }
  const length = Number(request.headers.get("content-length"));
  if (!Number.isInteger(length) || length < 1 || length > OPEN_TAB_BATCH_BYTES) return Response.json({ok:false},{status:413});
  const body = await request.text();
  if (Buffer.byteLength(body) !== length || Buffer.byteLength(body) > OPEN_TAB_BATCH_BYTES) return Response.json({ok:false},{status:413});
  if (!timingSafeEqual(Buffer.from(signature),Buffer.from(openTabSignature(key,stamp,body)))) return Response.json({ok:false},{status:401});
  let data;
  try { data = requestSchema.parse(JSON.parse(body)); }
  catch { return Response.json({ok:false},{status:422}); }

  const db = getSupabaseServiceClient();
  const repository = new PropertyLifecycleRepository(db);
  const radar = new PrivateRadarBridge(db);
  const runs = new Map<string,{id:string;count:number;errors:number;created:number;updated:number;unchanged:number;review:number; failureCodes:Record<string,number>}>();
  const results: OpenTabOutcome[] = [];
  const deadline = Date.now() + 42_000;
  for (const capture of data.captures) {
    const out = (state:OpenTabOutcome["state"],message?:string) => results.push({url:capture.url,state,message});
    if (Date.now() >= deadline) {
      out("error","Limite di attesa raggiunto prima del salvataggio. Puoi riprovare questa scheda.");
      continue;
    }
    try {
      const recognized = openTabSource(capture.url);
      const age = Number(stamp) - Date.parse(capture.capturedAt);
      if (!recognized || recognized.url !== capture.url || age < -10_000 || age > 600_000) { out("review","Identità o orario della scheda non verificabile."); continue; }
      const {source,url} = recognized;
      if (source.portal) {
        const portal = source.id as PrivatePortal;
        const listingId = PRIVATE_PORTALS[portal].id.exec(new URL(url).pathname)?.[1];
        if (!listingId || !capture.fields) { out("review","Dati del portale incompleti."); continue; }
        const observation = privateObservationFromCapture(portal,url,directObservationId(portal,listingId),capture.fields,capture.capturedAt,capture.capturedAt);
        if (!observation) { out("skipped","Scheda fuori ambito, di agenzia o vendita non verificata."); continue; }
        if(capture.fields.sellerType!=="private"&&portal!=="casadaprivato")observation.seller_type="unknown";
        const existing = await db.from("private_publications").select("content_hash,last_seen_at,first_seen_at,description,price_amount,surface_sqm,rooms,floor,metadata")
          .eq("source",portal).eq("source_listing_id",listingId).is("legacy_listing_id",null).maybeSingle();
        if (existing.error) throw existing.error;
        const prior = existing.data;
        if(prior){
          if(Date.parse(prior.last_seen_at)>Date.parse(capture.capturedAt)){out("unchanged","È già presente una lettura più recente.");continue;}
          observation.first_seen_at=prior.first_seen_at;
          observation.description??=prior.description;
          observation.price??=prior.price_amount;
          observation.sqm??=prior.surface_sqm;
          observation.rooms??=prior.rooms;
          observation.floor??=prior.floor;
          if(!observation.image_urls?.length&&Array.isArray(prior.metadata?.imageUrls))observation.image_urls=prior.metadata.imageUrls;
          if(observation.seller_type==="unknown"&&prior.metadata?.sellerType==="private"){
            observation.seller_type="private";
            observation.seller_classification_confidence=prior.metadata.sellerClassificationConfidence??observation.seller_classification_confidence;
          }
        }
        const result = await radar.sync([observation]);
        if(result.reviewRequired||result.soldOrManualConflicts||observation.seller_type==="unknown") { out("review","Fonte privata o abbinamento da verificare."); continue; }
        if(result.createdPublications){out("new");continue;}
        if(!prior || result.unchangedPublications){out("unchanged");continue;}
        const current = await db.from("private_publications").select("content_hash").eq("source",portal).eq("source_listing_id",listingId).is("legacy_listing_id",null).maybeSingle();
        if(current.error)throw current.error;
        out(current.data?.content_hash===prior.content_hash?"unchanged":"updated");
        continue;
      }
      if(!capture.html){out("review","Contenuto della scheda d’agenzia mancante.");continue;}
      if(source.id==="garofalo"){out("review","Il parser Garofalo richiede i dati strutturati. Apri l’esito per ritrovare la scheda.");continue;}
      const adapter=basePropertyLifecycleAdapter(source.id);
      const parsed=new URL(url), parts=parsed.pathname.split("/").filter(Boolean);
      const identity=source.detailQuery ? [...parsed.searchParams].find(([name])=>name.toLowerCase()===source.detailQuery)?.[1]
        : source.id==="iconacasa" ? parts.at(-1)?.match(/^\d+/)?.[0] : parts.at(-1)?.match(/tc-\d+-(\d+)$/)?.[1]??parts.at(-1);
      if(!identity){out("review","Identificativo della scheda non disponibile.");continue;}
      let listing;
      try {
        listing=await adapter.normalize({item:{url,sourceKey:identity,externalId:identity,summary:{manualOpenTab:true}},
          observedAt:capture.capturedAt,response:{body:capture.html,headers:new Headers(),url,status:200,ok:true}});
      } catch (error) {
        out("review", error instanceof StudiSantiDetailIdentityError
          ? error.message : "Il formato della pagina non consente una lettura verificabile.");
        continue;
      }
      const canonical = openTabSource(listing.source.canonicalUrl);
      if (!canonical || openTabIdentity(canonical) !== openTabIdentity(recognized) || listing.source.agencySlug !== adapter.agencySlug) {
        out("review", canonical
          ? "La pagina dichiara il codice di un altro annuncio."
          : "La pagina non dichiara un riferimento verificabile per questo annuncio.");
        continue;
      }
      if(source.id==="admaiora")listing=rehashNormalizedListing(listing,row=>({...row,source:{...row.source,sourceKey:row.source.externalId}}));
      if(listing.source.transactionType!=="SALE"||listing.location.scope==="OUT_OF_SCOPE"){out("skipped","Scheda fuori dall’ambito delle vendite monitorate.");continue;}
      const agency=await repository.getAgencyBySlug(adapter.agencySlug);
      const publication=await db.from("publications").select("id").eq("agency_id",agency.id).eq("source_key",listing.source.sourceKey).maybeSingle();
      if(publication.error)throw publication.error;
      if(publication.data){
        const record=await db.from("snapshots").select("normalized_payload,observed_at").eq("publication_id",publication.data.id).order("observed_at",{ascending:false}).limit(1).maybeSingle();
        if(record.error)throw record.error;
        if(record.data&&Date.parse(record.data.observed_at)>Date.parse(capture.capturedAt)){out("unchanged","È già presente una lettura più recente.");continue;}
        const previous=normalizedListingV2Schema.safeParse(record.data?.normalized_payload);
        if(previous.success){
          const prior=previous.data;
          listing=rehashNormalizedListing(listing,row=>({
            ...row,
            source:{...row.source,agencyReference:row.source.agencyReference??prior.source.agencyReference,
              portalPublishedAt:row.source.portalPublishedAt??prior.source.portalPublishedAt,
              portalModifiedAt:row.source.portalModifiedAt??prior.source.portalModifiedAt},
            commercial:{...prior.commercial,...Object.fromEntries(Object.entries(row.commercial).filter(([,value])=>value!==null)),features:{...prior.commercial.features,...row.commercial.features}},
            location:row.location.scope==="REVIEW" || (!row.location.streetNumber && prior.location.streetNumber && row.location.streetName===prior.location.streetName) ? prior.location : row.location,
            status:row.status.value==="UNKNOWN"?prior.status:row.status,
            assets:row.assets.length?row.assets:prior.assets,
          }));
        }
      }
      if(listing.location.scope!=="IN_SCOPE"){out("review","Località da verificare prima del salvataggio.");continue;}
      let run=runs.get(agency.id);
      if(!run){
        run={id:await repository.createSyncRun({agencyId:agency.id,adapterKey:adapter.key,mode:"SYNC"}),count:0,errors:0,created:0,updated:0,unchanged:0,review:0,failureCodes:{}};
        runs.set(agency.id,run);
      }
      run.count++;
      let saved;
      try {
        saved = await repository.persistObservation(agency.id, run.id, listing, [], { manualWorkerCapture: true });
      } catch (error) {
        run.errors++;
        const code = error instanceof Error ? (error.cause as {code?: unknown} | undefined)?.code : undefined;
        const category = typeof code === "string" && /^(?:[A-Z0-9]{5}|PGRST[0-9]{3})$/.test(code) ? code : "UNKNOWN";
        run.failureCodes[category] = (run.failureCodes[category] ?? 0) + 1;
        out("error", category === "57014" || category === "55P03"
          ? "Il database ha interrotto il salvataggio per attesa. Puoi riprovare questa scheda."
          : `Salvataggio non confermato. Riferimento database ${category === "UNKNOWN" ? "non disponibile" : category}.`);
        continue;
      }
      if ("deferred" in saved || saved.identityDecision.outcome === "REVIEW_REQUIRED") {
        run.review++;
        out("review","Abbinamento immobile da verificare.");
        continue;
      }
      if (saved.createdPublication) { run.created++; out("new"); }
      else if (saved.changed === false) { run.unchanged++; out("unchanged"); }
      else { run.updated++; out("updated"); }
    } catch { out("error","Salvataggio non confermato. Puoi ripetere l’acquisizione."); }
  }
  const summaries = await Promise.allSettled([...runs.values()].map(run => {
    const confirmed = run.created + run.updated + run.unchanged;
    return repository.finalizeSyncRun({
      syncRunId:run.id,status:confirmed===run.count?"SUCCEEDED":run.errors===run.count?"FAILED":"PARTIAL",
      healthState:"DEGRADED",inventoryComplete:false,absenceEvaluationAllowed:false,
      expectedCount:null,structureFingerprint:"manual-open-tabs",
      diagnostics:{origin:"manual-open-tabs",acquisitionId:data.acquisitionId,created:run.created,updated:run.updated,unchanged:run.unchanged,review:run.review,failureCodes:run.failureCodes},
      counts:{discoveredCount:run.count,normalizedCount:run.count,inScopeCount:confirmed,excludedCount:0,errorCount:run.errors,missingCount:0,transitionedCount:0},
    });
  }));
  const sourceReportPending = summaries.some(summary => summary.status === "rejected");
  if (runs.size && !sourceReportPending) revalidatePath("/fonti");
  if(results.some(result=>result.state==="new"||result.state==="updated"||result.state==="review"))revalidatePath("/intelligence");
  return Response.json(sourceReportPending ? { results, sourceReportPending } : { results });
}
