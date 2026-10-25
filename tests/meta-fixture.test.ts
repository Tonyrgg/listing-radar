import {it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {mapMetaFixtureLead,parseMetaFixtureNotices,type MetaFixtureMapping} from '@/lib/seller-intake/meta-fixture';
const secret='synthetic-app-secret-never-used-live-12345';
const event={object:'page',entry:[{id:'100',changes:[{field:'leadgen',value:{page_id:'100',form_id:'200',leadgen_id:'300',ad_id:'400'}}]}]};
const body=Buffer.from(JSON.stringify(event));
const signature=(v:Uint8Array)=>'sha256='+createHmac('sha256',secret).update(v).digest('hex');
const mapping:MetaFixtureMapping={mode:'fixture_only',formId:'200',privacyVersion:'LOCAL_FIXTURE_ONLY',fields:{
 name:{name:'full_name'},phone:{name:'phone_number'},
 situation:{name:'situation',choices:{considering:'considering_sale'}},role:{name:'role',choices:{owner:'owner'}},
 locality:{name:'locality',choices:{local:'Bitonto'}},propertyType:{name:'type',choices:{flat:'apartment'}},timing:{name:'timing',choices:{unknown:'undecided'}},
 callbackRequested:{name:'callback',choices:{yes:true,no:false}},
 whatsappOptIn:{name:'whatsapp',choices:{yes:true,no:false}},
}};
const lead={id:'300',form_id:'200',field_data:Object.entries({full_name:'Persona sintetica',phone_number:'+39 000 0000000',situation:'considering',role:'owner',locality:'local',type:'flat',timing:'unknown',callback:'yes'}).map(([name,value])=>({name,values:[value]}))};
it('verifica il payload grezzo prima del JSON e conserva la chiave stabile nei replay',()=>{
 const notices=parseMetaFixtureNotices(body,signature(body),secret);
 expect(parseMetaFixtureNotices(body,signature(body),secret)).toEqual(notices);
 expect(()=>parseMetaFixtureNotices(Buffer.from(JSON.stringify(event,null,2)),signature(body),secret)).toThrow('SIGNATURE');
 expect(()=>parseMetaFixtureNotices(body,null,secret)).toThrow('SIGNATURE');
 expect(notices[0].externalId).toBe('meta_100_200_300');
});
it('mappa solo le scelte configurate, senza WhatsApp o qualifica inventati',()=>{
 const notice=parseMetaFixtureNotices(body,signature(body),secret)[0];
 const output=mapMetaFixtureLead(notice,lead,mapping);
 expect(output.whatsappOptIn).toBe(false);expect(output.attribution).toEqual({source:'meta_form',formId:'200',adId:'400'});
 expect(output).not.toHaveProperty('qualification_status');
 expect(mapMetaFixtureLead(notice,{...lead,field_data:[...lead.field_data].reverse()},mapping)).toEqual(output);
 for(const input of [{...lead,id:'999'},{...lead,field_data:[...lead.field_data,lead.field_data[0]]},{...lead,field_data:lead.field_data.filter(f=>f.name!=='callback')},
  {...lead,field_data:lead.field_data.map(f=>f.name==='callback'?{name:'callback',values:['no']}:f)},
  {...lead,field_data:lead.field_data.map(f=>f.name==='locality'?{name:'locality',values:['non-mapped']}:f)}])
  expect(()=>mapMetaFixtureLead(notice,input,mapping)).toThrow('MAPPING_INVALID');
});
it('rifiuta la stessa notifica con attribuzione discordante e firma valida',()=>{
 const conflict={object:'page',entry:[{id:'100',changes:[...event.entry[0].changes,{field:'leadgen',value:{page_id:'100',form_id:'200',leadgen_id:'300',ad_id:'999'}}]}]};
 const raw=Buffer.from(JSON.stringify(conflict));expect(()=>parseMetaFixtureNotices(raw,signature(raw),secret)).toThrow('NOTIFICATION_INVALID');
});
