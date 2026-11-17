import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {enrichPublicLocationEvidence} from '../../src/lib/property-lifecycle/adapters/public-location-evidence';
import {normalizeFuturaDetail} from '../../src/lib/property-lifecycle/adapters/futura';
const html=readFileSync('tests/fixtures/property-lifecycle/futura-active-detail.html','utf8');
describe('persistent location evidence',()=>{
 it('preserves both coordinates together and address across missing fields without inflating metadata',async()=>{
 const db=new PGlite();try{await db.exec(`create table locations(id int,manually_verified boolean,latitude float,longitude float,street_name text,street_number text,evidence_source text,metadata jsonb);create table properties(id int,canonical_attributes jsonb);`);await db.exec(readFileSync('supabase/migrations/0105_retain_known_property_location.sql','utf8'));
 await db.exec(`insert into locations values(1,false,41.1,16.6,'Via Roma','12','futura','{}');update locations set latitude=null,longitude=null,street_number=null;update locations set latitude=null,longitude=null;insert into properties values(1,'{"address":"Via Roma 12","latitude":41.1,"longitude":16.6}');update properties set canonical_attributes='{"latitude":null,"longitude":null}';`);
 const row=(await db.query<{latitude:number;longitude:number;street_number:string;metadata:unknown}>('select * from locations')).rows[0];expect(row).toMatchObject({latitude:41.1,longitude:16.6,street_number:'12'});expect(JSON.stringify(row.metadata).match(/retainedCoordinates/g)?.length).toBe(1);
 expect((await db.query<{canonical_attributes:unknown}>('select * from properties')).rows[0].canonical_attributes).toMatchObject({address:'Via Roma 12',latitude:41.1,longitude:16.6});
 await db.exec('update locations set latitude=41.2,longitude=16.7');expect((await db.query('select latitude from locations')).rows[0].latitude).toBe(41.2);
 }finally{await db.close();}
 });
 it('records public clues with source without turning them into confirmed coordinates or civic',()=>{
 const url='https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=2394707';
 // The fixture owns the canonical identity; derive it rather than inventing an ad.
 const id=html.match(/cod_annuncio=(\d+)/)?.[1]??'2394707';const source=url.replace('2394707',id);
 const doc={item:{sourceKey:id,externalId:id,url:source,summary:{}},observedAt:'2026-11-17T12:00:00Z',response:{body:html,status:200,ok:true,url:source,headers:new Headers()}};
 const listing=normalizeFuturaDetail(doc);doc.response.body+='<script type="application/ld+json">{"@type":"House","address":{"streetAddress":"Via Test 99"},"geo":{"latitude":41.1,"longitude":16.6}}</script><iframe src="https://www.google.com/maps?q=41.1,16.6"></iframe>';
 const out=enrichPublicLocationEvidence(listing,doc);expect(out.location).toEqual(listing.location);expect(out.provenance.publicLocationEvidence).toEqual(expect.arrayContaining([expect.objectContaining({method:'PROPERTY_JSONLD_ADDRESS',independentlyVerified:false}),expect.objectContaining({method:'PUBLISHED_MAP_FRAME'})]));
 });
});

it('restores a historical property pin while excluding shared locations and mismatched addresses',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table locations(id int,latitude float,longitude float,manually_verified boolean,street_name text,street_number text,metadata jsonb);create table properties(id int,primary_location_id int);create table agency_listings(id int,property_id int);create table publications(id int,agency_listing_id int,canonical_url text);create table snapshots(id int,publication_id int,observed_at timestamptz,normalized_payload jsonb);
 insert into locations values(1,null,null,false,'Via Roma','12','{}'),(2,null,null,false,'Via Roma','12','{}'),(3,null,null,false,'Via Diversa','12','{}');insert into properties values(1,1),(2,2),(3,2),(4,3);insert into agency_listings values(1,1),(2,2),(3,4);insert into publications values(1,1,'https://example.test/1'),(2,2,'https://example.test/2'),(3,3,'https://example.test/3');insert into snapshots select id,id,'2026-11-17', '{"adapterKey":"futura","location":{"latitude":41.1,"longitude":16.6,"streetName":"Via Roma","streetNumber":"12"}}'::jsonb from publications;`);
 await db.exec(readFileSync('supabase/migrations/0106_restore_saved_property_pins.sql','utf8'));
 const rows=(await db.query('select id,latitude from locations order by id')).rows;expect(rows).toEqual([{id:1,latitude:41.1},{id:2,latitude:null},{id:3,latitude:null}]);
 }finally{await db.close();}
});
