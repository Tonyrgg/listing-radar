import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {normalizeVistocasaDetail} from '../../src/lib/property-lifecycle/adapters/vistocasa';
import {applyPinAddress} from '../../src/lib/property-lifecycle/persistence/pin-address';
const html=readFileSync('tests/fixtures/property-lifecycle/vistocasa-active-detail.html','utf8');
function listing(){const id=html.match(/articoliid=(\d+)/i)?.[1]??'8661',url=`https://www.vistocasa.com/it/immobile.aspx?articoliid=${id}`;return normalizeVistocasaDetail({item:{sourceKey:id,externalId:id,url,summary:{}},response:{body:html,url,ok:true,status:200,headers:new Headers()},observedAt:'2026-11-17T12:00:00Z'});}
describe('publisher pin reverse address',()=>{
 it('keeps exact published coordinates and distinguishes the nearest civic candidate',()=>{const n=listing();n.location.latitude=41.105598;n.location.longitude=16.680485;n.location.streetName=null;n.location.streetNumber=null;
 const out=applyPinAddress(n,{address:{road:'Via Quinto Orazio Flacco',country_code:'it',house_number:'12'},lat:'41.1056064',lon:'16.6804814',osm_type:'way',osm_id:1});expect(out.location).toMatchObject({latitude:41.105598,longitude:16.680485,streetName:'Via Quinto Orazio Flacco',streetNumber:'12',precision:'EXACT_COORDINATES'});expect(out.location.reasons).toContain('civic_from_published_pin_reverse_lookup:not_entrance_verified');});
 it('never invents a civic for a street result or uses a distant building',()=>{const n=listing();n.location.latitude=41.105598;n.location.longitude=16.680485;n.location.streetName=null;n.location.streetNumber=null;
 const out=applyPinAddress(n,{address:{road:'Via Quinto Orazio Flacco',country_code:'it'},lat:'41.1056064',lon:'16.6804814'});expect(out.location.streetNumber).toBeNull();expect(applyPinAddress(n,{address:{road:'Other',country_code:'it',house_number:'99'},lat:'41.15',lon:'16.7'})).toBe(n);});
 it('does not substitute source street or number with a mismatching nearest road',()=>{const n=listing();n.location.latitude=41.105598;n.location.longitude=16.680485;n.location.streetName='Via Palombaio';n.location.streetNumber='7';expect(applyPinAddress(n,{address:{road:'Other',house_number:'12',country_code:'it'},lat:41.105598,lon:16.680485}).location).toMatchObject({streetName:'Via Palombaio',streetNumber:'7'});});
});
