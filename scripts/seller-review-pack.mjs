import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {makeReviewRows,GROUPS} from './seller-review-template.mjs';
import { makeReviewRows } from './seller-review-template.mjs';
const detected={market,opportunities:top,sold,news:triage.candidates};
const reviews=makeReviewRows(detected);
// Reads frozen evidence only. Never reads credentials or connects to a database.
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length+3);
const input = arg('input'), news = arg('news'), output = arg('output');
if (!input || !news || !output) throw Error('Use --input=<market snapshot folder> --news=<triage final.json> --output=<new folder>');
const load = async file => JSON.parse(await readFile(file,'utf8'));
const market = await load(path.join(input,'validation-50.json'));
const top = await load(path.join(input,'top20-opportunities.json'));
const sold = await load(path.join(input,'sold-cases-audit.json'));
const triage = await load(news);
const detected={market,opportunities:top,sold,news:triage.candidates};
const reviews=makeReviewRows(detected);
const manifest={created_at:new Date().toISOString(),kind:'FROZEN_REVIEW_NOT_CURRENT_MARKET',
  counts:Object.fromEntries(GROUPS.map(g=>[g,reviews.filter(r=>r.group===g).length])),
  independent_human_reviews:0, source_hash:createHash('sha256').update(JSON.stringify(detected)).digest('hex')};
// Refuse overwrite: completed human answers must never be erased by a replay.
await mkdir(output,{recursive:false});
await writeFile(path.join(output,'review.json'),JSON.stringify(reviews,null,2));
await writeFile(path.join(output,'detected-separate.json'),JSON.stringify(detected,null,2));
await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
const escape = v => String(v).replace(/[\[\]<>|\r\n]/g,' ');
const lines=reviews.map(r=>`| ${r.review_id} | ${escape(r.address)} | ${r.source_urls.map((u,i)=>`[Fonte ${i+1}](${u})`).join(' · ')||'Aprire il dossier: URL primario mancante'} | Da valutare |`);
await writeFile(path.join(output,'LEGGIMI.md'),`# Revisione dei casi esistenti\n\nCampioni congelati del 19–20 ottobre 2026. Non attestano lo stato odierno. Nessun giudizio umano è stato aggiunto.\n\nApri prima le fonti, poi registra in review.json: judgement (CONFIRMED / REJECTED / NOT_ENOUGH_EVIDENCE), reviewer, reviewer_kind=human, reviewed_at, checked_source_url, observed_fact, commercial_usefulness e next_verification. Usa NOT_ENOUGH_EVIDENCE se una pagina non è leggibile. Un prezzo richiesto non è un prezzo di vendita. Le uscite non provano un incarico scaduto.\n\nLe previsioni del motore sono in detected-separate.json: consultarle dopo il primo giudizio riduce il condizionamento. Per IDENTITY verificare anche identità, civico, agenzia, prezzo e date: una singola conferma non certifica tutti i campi. Per OPPORTUNITY valutare lavorabilità reale; per SOLD cercare una conferma distinta dal parser; per NEWS distinguere fatto, localizzazione e utilità.\n\nIl pacchetto non modifica database o ranking. La calibrazione verrà eseguita soltanto sui giudizi completati e sulle dimensioni effettivamente verificate.\n\n| Caso | Indirizzo / claim da verificare | Prove | Giudizio |\n|---|---|---|---|\n${lines.join('\n')}\n`);
console.log(JSON.stringify(manifest,null,2));
