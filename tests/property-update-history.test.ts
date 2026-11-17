import {it,expect} from 'vitest';
import {compareSavedReadings} from '@/lib/property-lifecycle/read-models/update-history';
import {previousReceiptEntry} from '@/lib/workspace-update-model';
it('reconstructs actual differences from saved readings rather than repeating current data',()=>{
 const old={commercial:{priceAmount:250000,rooms:3,features:{}},location:{streetName:'Via Test',streetNumber:null,latitude:41.1},source:{},status:{value:'UNKNOWN'},assets:[]};
 const current={...old,commercial:{...old.commercial,priceAmount:230000,features:{adMaioraCrossCheck:{checks:{wordpress:'verified_identity'}}}},location:{...old.location,latitude:null,streetNumber:'29'}};
 const changes=compareSavedReadings(old,current,'2026-11-17T09:00:00Z','https://example.org/property');
 expect(changes).toEqual(expect.arrayContaining([expect.objectContaining({field:'latest_asking_price',before:250000,after:230000}),expect.objectContaining({field:'street_number',before:null,after:'29'}),expect.objectContaining({field:'wordpress_verification',before:null,after:'HTML e WordPress controllati'})]));
 expect(changes.some(c=>c.field==='rooms')).toBe(false);
 expect(changes.every(c=>c.sourceUrl==='https://example.org/property')).toBe(true);
});
it('ignores an address case change and keeps the original receipt timestamp for legacy recovery',()=>{
 expect(compareSavedReadings({location:{streetName:'Via TEST'}},{location:{streetName:'via test'}},'2026-11-17T00:00:00Z','https://example.org')).toEqual([]);
 const entry=previousReceiptEntry([{key:'u:read:mercato',value:{p:'legacy'},updated_at:'2026-11-15T00:00:00Z'}],'u','mercato','p');expect(entry).toMatchObject({value:'legacy',updated_at:'2026-11-15T00:00:00Z'});
});
