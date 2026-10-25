import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeReviewRows, GROUPS } from './seller-review-template.mjs';
const judgements = new Set(['CONFIRMED','REJECTED','NOT_ENOUGH_EVIDENCE']);
const dimensions = {
  IDENTITY:['identity','address','agency','asking_price','dates'],
  OPPORTUNITY:['usefulness','relevance'],
  SOLD:['sale_confirmation','transaction_price','disappearance'],
  NEWS:['fact','location','usefulness'],
};
const filled = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
const https = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const stat = () => ({pending:0,reviewed:0,confirmed:0,rejected:0,insufficient:0,independent:0,agreement:null});
function add(target, judgement) {
  target.reviewed++;
  target[judgement==='CONFIRMED'?'confirmed':judgement==='REJECTED'?'rejected':'insufficient']++;
}
function finish(target) {
  const denominator=target.confirmed+target.rejected;
  target.agreement=denominator?target.confirmed/denominator:null;
}
export function analyzeReviews({manifest,reviews,detected}, now=Date.now()) {
  const hash=createHash('sha256').update(JSON.stringify(detected)).digest('hex');
  if(manifest.kind!=='FROZEN_REVIEW_NOT_CURRENT_MARKET'||manifest.source_hash!==hash)throw Error('Snapshot o hash non coerente.');
  const expected=makeReviewRows(detected), byId=new Map(expected.map(row=>[row.review_id,row]));
  if(!Array.isArray(reviews)||reviews.length!==expected.length)throw Error('Campione incompleto o esteso.');
  const groups=Object.fromEntries(GROUPS.map(group=>[group,{...stat(),dimensions:{}}])), seen=new Set();
  for(const row of reviews) {
    const original=byId.get(row.review_id);
    if(!original||seen.has(row.review_id))throw Error('ID fuori campione o duplicato: '+row.review_id);
    seen.add(row.review_id);
    for(const key of ['group','property_id','candidate_id','address','dossier','source_urls','snapshot_date'])
      if(JSON.stringify(row[key])!==JSON.stringify(original[key]))throw Error('Identità congelata modificata: '+row.review_id);
    const group=groups[row.group];
    if(row.judgement===null) {
      if(['reviewer','reviewer_kind','reviewed_at','checked_source_url','observed_fact','commercial_usefulness','next_verification'].some(key=>row[key]!=null))
        throw Error('Revisione incompleta: '+row.review_id);
      group.pending++; continue;
    }
    if(!judgements.has(row.judgement)||!filled(row.reviewer)||row.reviewer_kind!=='human'
      ||!filled(row.reviewed_at)||!Number.isFinite(Date.parse(row.reviewed_at))
      ||Date.parse(row.reviewed_at)<Date.parse(row.snapshot_date)||Date.parse(row.reviewed_at)>now
      ||!https(row.checked_source_url)||!filled(row.observed_fact))
      throw Error('Giudizio o evidenza incompleta: '+row.review_id);
    if(['OPPORTUNITY','NEWS'].includes(row.group)&&!filled(row.commercial_usefulness))
      throw Error('Utilità non valutata: '+row.review_id);
    if(row.prediction_seen!=null&&typeof row.prediction_seen!=='boolean')throw Error('Indipendenza non valida: '+row.review_id);
    if(row.judgement==='NOT_ENOUGH_EVIDENCE'&&!filled(row.next_verification))throw Error('Manca il controllo successivo: '+row.review_id);
    add(group,row.judgement);
    if(row.prediction_seen===false)group.independent++;
    if(row.field_judgements!=null) {
      if(typeof row.field_judgements!=='object'||Array.isArray(row.field_judgements))throw Error('Dimensioni non valide: '+row.review_id);
      for(const [key,value] of Object.entries(row.field_judgements)) {
        if(!dimensions[row.group].includes(key)||!judgements.has(value))throw Error('Dimensione o giudizio non valido: '+row.review_id);
        const dimension=group.dimensions[key]??=stat(); add(dimension,value);
        if(row.prediction_seen===false)dimension.independent++;
      }
    }
  }
  for(const group of GROUPS) {
    if(manifest.counts[group]!==expected.filter(row=>row.group===group).length)throw Error('Conteggio manifest incoerente: '+group);
    finish(groups[group]); for(const field of Object.values(groups[group].dimensions))finish(field);
  }
  return {kind:'FROZEN_HUMAN_REVIEW_REPORT',source_hash:hash,total:reviews.length,
    reviewed:Object.values(groups).reduce((n,g)=>n+g.reviewed,0),
    independent:Object.values(groups).reduce((n,g)=>n+g.independent,0),groups,
    limitations:['Giudizi dichiarati umani, non verificati da questo programma.','Indipendenza conteggiata solo se prediction_seen=false.','Conferma globale e dimensioni valutate sono distinte.','Agreement è la quota di conferme fra conferme/rifiuti; non certifica il ranking corrente.','Un prezzo richiesto non prova un prezzo di transazione; una scomparsa non prova una vendita.']};
}
export async function reportFolder(input,output) {
  const load=async name=>JSON.parse(await readFile(path.join(input,name),'utf8'));
  const report=analyzeReviews({manifest:await load('manifest.json'),reviews:await load('review.json'),detected:await load('detected-separate.json')});
  await mkdir(output,{recursive:false});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const lines=GROUPS.map(group=>{const s=report.groups[group];return '| '+group+' | '+s.pending+' | '+s.reviewed+' | '+s.independent+' | '+s.confirmed+' | '+s.rejected+' | '+s.insufficient+' |';});
  await writeFile(path.join(output,'REPORT.md'),'# Revisione del campione congelato\n\nGiudizi compilati: '+report.reviewed+'/'+report.total+'. Indipendenti dichiarati: '+report.independent+'. Nessun peso o database modificato.\n\n| Gruppo | In attesa | Valutati | Indipendenti | Confermati | Rifiutati | Prove insufficienti |\n|---|---|---|---|---|---|---|\n'+lines.join('\n')+'\n\n'+report.limitations.map(value=>'- '+value).join('\n')+'\n');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg=name=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
  const input=arg('input'),output=arg('output');
  if(!input||!output)throw Error('Usa --input=<cartella congelata> --output=<nuova cartella>');
  const report=await reportFolder(input,output);
  console.log(JSON.stringify({total:report.total,reviewed:report.reviewed,independent:report.independent}));
}
