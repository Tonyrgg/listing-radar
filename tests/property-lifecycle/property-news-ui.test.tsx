import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {NewsCardContent,historyCandidate} from '@/components/news-card';
import {extractPropertyFacts} from '@/lib/property-lifecycle/buildings/property-facts';
import type {FactNews} from '@/lib/property-lifecycle/buildings/facts-read-model';
it('public news separates fact, interpretation, unknown sale intent and expandable primary provenance',()=>{
 const f=extractPropertyFacts('r',{text:'divisione in due unità',field:'Oggetto',sourceUrl:'https://official.example/record.csv',sourceHash:'a'.repeat(64),observedAt:'2026-10-20T12:00:00Z',row:22},'2025-01-01')[0];
 const row={...f,fact:f,event_id:f.id,record_id:'r',source:'Comune di Bitonto',territorial_level:'BUILDING',building_id:'b',property_id:null,street:'Via test',civic:'2',active_properties:0,historical_properties:1,rank:65} as unknown as FactNews;
 const html=renderToStaticMarkup(<NewsCardContent candidate={historyCandidate(row)}/>);
 for(const expected of ['Cosa sappiamo','Perché può interessarti','Cosa non sappiamo','futura vendita non è dimostrata','Prove e provenienza','riga 22','https://official.example/record.csv','non identifica la singola unità'])expect(html).toContain(expected);
 expect(html).not.toContain('Crea lead');expect(html).not.toContain('incarico scaduto');
 expect(html).toContain('Mercato conosciuto');expect(html).not.toContain('annunci attivi');
});
