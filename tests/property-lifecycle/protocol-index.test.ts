import {describe,it,expect,vi} from 'vitest';
import {readTerritoryProtocolIndex,read2025PracticeIndex} from '@/lib/property-lifecycle/buildings/protocol-index';
import {BITONTO_PROTOCOL_OFFICES} from '@/lib/property-lifecycle/buildings/protocol-register';
import {normalizeBuildingPracticeRows,parseBuildingPracticeCsv} from '@/lib/property-lifecycle/buildings/practices';
const fields=['_id','Applicazione','Numero Pratica','Oggetto','Data Protocollo','Numero Protocollo','Ufficio Responsabile'].map(id=>({id}));
const row={_id:1,Applicazione:'apg','Numero Pratica':'12/2026/SCIA',Oggetto:'Persona sintetica - cambio destinazione d uso','Data Protocollo':'2026-09-16T00:00:00','Numero Protocollo':123,'Ufficio Responsabile':BITONTO_PROTOCOL_OFFICES[0]};
const response=(records:unknown[],schema=fields)=>new Response(JSON.stringify({success:true,result:{records,fields:schema}}),{headers:{'content-type':'application/json'}});
describe('official territorial protocol adapter',()=>{
 it('reads the annual register through the regional API even when the old CSV host is unavailable',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response([{total:1}])).mockResolvedValueOnce(response([row])).mockResolvedValueOnce(response([{total:1}]));
  const result=await read2025PracticeIndex(fetcher);
  expect(result.inputRows).toBe(1);
  expect(fetcher.mock.calls.every(([url])=>new URL(url).hostname==='dati.puglia.it')).toBe(true);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('sql')).toContain('ac5b1cf7-c4c3-4b42-8a00-88ea9df5ce2b');
 });
 it('reads only exact offices and produces a bounded in-memory index without storing subject text',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response([{total:1}])).mockResolvedValueOnce(response([row])).mockResolvedValueOnce(response([{total:1}]));
  const result=await readTerritoryProtocolIndex(fetcher);
  expect(result).toMatchObject({pages:1,inputRows:1});
  const records=normalizeBuildingPracticeRows(parseBuildingPracticeCsv(result.csv),{applicationCode:null,includeProtocolIdentity:true}).records;
  expect(records[0].sanitizedPayload.registryIdentity).toMatchObject({protocolDate:'2026-09-16'});
  expect(JSON.stringify(records)).not.toContain('Persona sintetica');
  for(const [url,options] of fetcher.mock.calls){expect(new URL(url).hostname).toBe('dati.puglia.it');expect(new URL(url).searchParams.get('sql')).toContain('"Ufficio Responsabile" IN');expect(options.redirect).toBe('error');}
 });
 it('fails before persistence when a page leaves the allowed offices or changes schema',async()=>{
  for(const bad of [response([{...row,'Ufficio Responsabile':'Servizio anagrafe'}]),response([row],fields.slice(0,-1))]){
   const fetcher=vi.fn().mockResolvedValueOnce(response([{total:1}])).mockResolvedValueOnce(bad);
   await expect(readTerritoryProtocolIndex(fetcher)).rejects.toThrow();
  }
 });
 it('rejects a changing count and an unexpected inventory size',async()=>{
  const drift=vi.fn().mockResolvedValueOnce(response([{total:1}])).mockResolvedValueOnce(response([row])).mockResolvedValueOnce(response([{total:2}]));
  await expect(readTerritoryProtocolIndex(drift)).rejects.toThrow('changed');
  const tooLarge=vi.fn().mockResolvedValue(response([{total:8001}]));
  await expect(readTerritoryProtocolIndex(tooLarge)).rejects.toThrow('inventory size');
  expect(tooLarge).toHaveBeenCalledTimes(1);
 });
});
