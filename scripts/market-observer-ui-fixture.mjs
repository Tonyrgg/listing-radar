/** Read-only, synthetic PostgREST fixture for local browser verification. */
import {createServer} from "node:http";
const propertyId="11111111-1111-4111-8111-111111111111";
const agencyId="22222222-2222-4222-8222-222222222222";
const listingId="33333333-3333-4333-8333-333333333333";
const publicationId="44444444-4444-4444-8444-444444444444";
const opportunityId="55555555-5555-4555-8555-555555555555";
const first="2026-04-01T10:00:00Z",last="2026-10-13T10:00:00Z";
const source="https://agency.example/property/123";
const components={observed_age:25,price_drops:5,price_reduction:10};
const intelligence={row_id:listingId,agency_listing_id:listingId,property_id:propertyId,agency_id:agencyId,agency_name:"Agenzia esempio",
  address:"Via Giuseppe Mazzini 10",locality:"Bitonto",state:"ACTIVE",sale_status:"UNKNOWN",property_state:"ACTIVE_AGENCY",
  earliest_market_evidence_at:first,sold_at:null,delisted_at:null,estimated_acquisition_at:null,acquisition_confidence:null,
  first_seen_at:first,last_seen_at:last,exit_classification:"ACTIVE",exit_confidence:null,first_asking_price:150000,
  latest_asking_price:135000,reduction_percent:10,drop_count:1,price_source_url:source,opportunity_score:40,
  reasons:["observed_market_age:195","price_drops:1","price_reduction_percent:10"],evidence_summary:{components,ruleVersion:2}};
const property={id:propertyId,building_id:null,primary_location_id:null,property_type:"Appartamento",identity_status:"PROVISIONAL",sale_status:"UNKNOWN",property_state:"ACTIVE_AGENCY",
  true_market_start_lower_bound:first,true_market_start_upper_bound:first,true_market_start_method:"WORDPRESS_JSON_LD_DATE_PUBLISHED",true_market_start_confidence:0.9,
  relaunch_count:0,first_seen_at:"2026-09-01T10:00:00Z",last_seen_at:last,representative_image_paths:[],
  canonical_attributes:{address:intelligence.address,locality:"Bitonto",surfaceSqm:90,rooms:3,priceAmount:135000}};
const opportunity={id:opportunityId,property_id:propertyId,level:"WATCH",status:"OPEN",score:40,detected_at:last,reasons:intelligence.reasons,evidence_summary:intelligence.evidence_summary};
const tables={properties:[property],opportunities:[opportunity],private_publications:[],manual_overrides:[],
  publications:[{id:publicationId,agency_listing_id:listingId,source_key:"123",canonical_url:source,state:"ACTIVE",source_status:"UNKNOWN",first_seen_at:"2026-09-01T10:00:00Z",last_seen_at:last,portal_published_at:first,portal_modified_at:last}],
  evidence:[{id:"66666666-6666-4666-8666-666666666666",publication_id:publicationId,evidence_kind:"MARKET_START",claim_key:"publication.datePublished",extraction_method:"WORDPRESS_JSON_LD_DATE_PUBLISHED",confidence:0.9,observed_at:"2026-09-01T10:00:00Z",source_recorded_at:first,source_url:source}],
  events:[{id:"77777777-7777-4777-8777-777777777777",property_id:propertyId,event_type:"PRICE_DROP",occurred_at:last,confidence:1,actor_type:"SYSTEM",payload:{oldPrice:150000,newPrice:135000}}],
  market_observer_publication_metrics:[{publication_id:publicationId,first_asking_price:150000,latest_asking_price:135000,reduction_percent:10,drop_count:1,canonical_url:source}],
};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost"),table=url.pathname.split("/").at(-1);
  res.setHeader("Content-Type","application/json");
  if(req.method!=="GET" && !url.pathname.endsWith("/rpc/lifecycle_property_hydration")) {
    res.writeHead(403);res.end(JSON.stringify({message:"This fixture is read-only."}));return;
  }
  let data=tables[table]??[];
  if(table==="market_observer_intelligence") {
    const filtered=url.searchParams.get("exit_classification")??"";
    if(filtered.includes("SOLD_CONFIRMED") && !filtered.includes("ACTIVE")) data=[{...intelligence,exit_classification:"SOLD_CONFIRMED",sale_status:"SOLD_CONFIRMED",sold_at:"2026-10-01T10:00:00Z",exit_confidence:0.98}];
    else data=[intelligence,{...intelligence,row_id:"88888888-8888-4888-8888-888888888888",agency_listing_id:"88888888-8888-4888-8888-888888888888",address:"Via Goffredo Mameli 7",agency_name:"Seconda agenzia",reduction_percent:null,drop_count:0}];
  }
  if(table==="lifecycle_property_hydration") data=[{property_id:propertyId,
    agency_refs:[{id:agencyId,slug:"agenzia-esempio",name:"Agenzia esempio",listingId,state:"ACTIVE",reference:"R-123",firstSeenAt:property.first_seen_at,lastSeenAt:last}],
    latest_snapshot:{title:"Appartamento a Bitonto",price_amount:135000,surface_sqm:90,rooms:3,observed_at:last,earliest_market_evidence_at:first},latest_private:null,active_private_count:0}];
  if(req.headers.accept?.includes("vnd.pgrst.object")) data=data[0]??null;
  res.writeHead(200);res.end(JSON.stringify(data));
});
server.listen(54329,"127.0.0.1",()=>console.log("Read-only synthetic UI fixture ready on port 54329."));
process.on("SIGTERM",()=>server.close());
