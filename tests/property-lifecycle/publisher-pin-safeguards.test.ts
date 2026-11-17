import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {normalizeFuturaDetail} from '../../src/lib/property-lifecycle/adapters/futura';
import {applyPinAddress} from '../../src/lib/property-lifecycle/persistence/pin-address';
const html=readFileSync('tests/fixtures/property-lifecycle/futura-active-detail.html','utf8');
function listing(){const id=html.match(/cod_annuncio=(\d+)/)?.[1]??'2394707',url=`https://www.futurabitonto.it/web/immobile_dettaglio.asp?cod_annuncio=${id}`;const n=normalizeFuturaDetail({item:{sourceKey:id,externalId:id,url,summary:{}},response:{body:html,url,ok:true,status:200,headers:new Headers()},observedAt:'2026-11-17T12:00:00Z'});n.location.latitude=41.1056;n.location.longitude=16.6804;n.location.streetName=null;n.location.streetNumber=null;return n;}
describe('pin address safeguards',()=>{
 it('does not promote a civic 33 metres from the pin',()=>{const n=listing(),out=applyPinAddress(n,{address:{road:'Via Roma',house_number:'1',town:'Bitonto',country_code:'it'},lat:41.1059,lon:16.6804});expect(out.location.streetName).toBe('Via Roma');expect(out.location.streetNumber).toBeNull();});
 it('rejects a geocoding result naming another municipality',()=>{const n=listing();expect(applyPinAddress(n,{address:{road:'Via Roma',house_number:'1',town:'Bari',country_code:'it'},lat:41.1056,lon:16.6804})).toBe(n);});
});
