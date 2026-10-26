import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {AlboDetailUnavailableError,parseAlboDetail} from '@/lib/property-lifecycle/buildings/albo';
const notice='<div class="alert alert-danger">Errore! Attenzione! Atto non disponibile o non più in pubblicazione.</div>';
describe('Disponibilità del dettaglio Albo',()=>{
 it('distingue il messaggio ufficiale da un cambiamento del formato',()=>{
  try{parseAlboDetail('<title>Albo Pretorio</title>'+notice,'10532771');throw Error('Expected unavailable source');}
  catch(error){expect(error).toBeInstanceOf(AlboDetailUnavailableError);expect(error).toMatchObject({code:'PUBLICATION_UNAVAILABLE'});}
 });
 it('conserva il controllo del formato per risposte non riconosciute',()=>{
  expect(()=>parseAlboDetail('<main>Risposta non riconosciuta</main>','10532771')).toThrow('structure changed');
 });
 it('non interpreta una citazione libera come messaggio di indisponibilità del portale',()=>{
  expect(()=>parseAlboDetail(notice.replaceAll('div','p').replace(' class="alert alert-danger"',''),'10532771')).toThrow('structure changed');
 });
 it('legge comunque un dettaglio valido in presenza di un avviso accessorio',()=>{
  const fixture=readFileSync('tests/fixtures/property-lifecycle/municipal/albo/detail-10579138.html','utf8');
  expect(parseAlboDetail(fixture+notice,'10579138').documentDate).toBe('2026-10-19');
 });
});
