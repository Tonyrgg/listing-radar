import {expect,it} from 'vitest';
import {groupRelevance,groupUrl,proposeGroupEnvironments,type GroupSnapshot} from '@/lib/tonybook/groups';
import type {TonyRegistry} from '@/lib/tonybook/registry';
const snapshot=(groups:GroupSnapshot['groups']):GroupSnapshot=>({version:1,sourceUrl:'https://www.facebook.com/groups/joins/',observedAt:'2026-10-26T08:00:00Z',groups,reportedTotal:groups.length,hasNextPage:false,endObserved:true});
it('riconosce località esplicite senza equiparare Bari o un nome generico a Bitonto',()=>{
 expect(groupRelevance('Case a Bitonto')).toMatchObject({geography:'EXPLICIT_LOCAL',topic:'PROPERTY'});
 expect(groupRelevance('Noi Bitontini')).toMatchObject({geography:'EXPLICIT_LOCAL'});
 expect(groupRelevance('Mariotto e Palombaio')).toMatchObject({geography:'EXPLICIT_LOCAL'});
 expect(groupRelevance('Case a Bari e provincia').geography).toBe('REGIONAL_REVIEW');
 expect(groupRelevance('Bitontopolis immobiliare').geography).toBe('UNCLEAR');
});
it('normalizza link diretti e rifiuta post, destinazioni estranee e pagine di servizio',()=>{
 expect(groupUrl('https://m.facebook.com/groups/12345?ref=share')).toBe('https://www.facebook.com/groups/12345/');
 for(const url of ['https://evil.test/groups/12345','https://www.facebook.com/groups/joins/','https://www.facebook.com/groups/12345/posts/999','https://user:pass@www.facebook.com/groups/12345/'])expect(()=>groupUrl(url)).toThrow();
});
it('propone soltanto gruppi dichiarati iscritti e locali, mai attività esterne',()=>{
 const r=proposeGroupEnvironments(snapshot([{name:'Case Bitonto',url:'https://www.facebook.com/groups/123/',membership:'JOINED'},{name:'Case Bari',url:'https://www.facebook.com/groups/456/',membership:'JOINED'},{name:'Bitonto',url:'https://www.facebook.com/groups/789/',membership:'UNKNOWN'}]));
 expect(r.proposed).toBe(1);expect(r.environments[0]).toMatchObject({id:'E001',decisione:'DA VALUTARE',regole_verificate_il:'',ultimo_esame:''});
 expect(r.collectionVerified).toBe(false);expect(r.coverage).toBe('PARTIAL');
});
it('deduplica varianti URL e non trasforma conteggi discordanti in raccolta completa',()=>{
 const s=snapshot([{name:'Bitonto',url:'https://m.facebook.com/groups/123/',membership:'JOINED'},{name:'Bitonto',url:'https://www.facebook.com/groups/123/?ref=foo',membership:'JOINED'}]);
 const r=proposeGroupEnvironments(s);expect(r.uniqueGroups).toBe(1);expect(r.duplicates).toBe(1);expect(r.coverage).toBe('PARTIAL');expect(r.environments).toHaveLength(1);
});
it('mantiene decisioni e regole preesistenti, compreso uno scarto, senza sovrascriverle',()=>{
 const data={id:'E007',nome:'Nome scelto',url:'https://www.facebook.com/groups/123/',decisione:'SCARTATO',regole_osservate:'Scelta umana',note:'Nota conservata'};
 const registry={version:1,records:[{id:'E007',kind:'environments',data,state:'REJECTED'}]} as unknown as TonyRegistry;
 const before=structuredClone(registry),r=proposeGroupEnvironments(snapshot([{name:'Nuovo nome Bitonto',url:'https://m.facebook.com/groups/123/',membership:'JOINED'},{name:'Palombaio',url:'https://www.facebook.com/groups/456/',membership:'JOINED'}]),registry);
 expect(registry).toEqual(before);expect(r.environments[0]).toEqual(data);expect(r.environments[1]?.id).toBe('E008');expect(r.proposed).toBe(1);
});
it('distingue dichiarazione di completezza da verifica della raccolta e rifiuta istanti senza data',()=>{
 const s=snapshot([{name:'Bitonto',url:'https://www.facebook.com/groups/123/',membership:'JOINED'}]);
 expect(proposeGroupEnvironments(s)).toMatchObject({coverage:'DECLARED_COMPLETE',collectionVerified:false});
 expect(()=>proposeGroupEnvironments({...s,observedAt:'ieri'})).toThrow();
 expect(()=>proposeGroupEnvironments({...s,sourceUrl:'https://evil.test/groups/joins/'})).toThrow();
});
