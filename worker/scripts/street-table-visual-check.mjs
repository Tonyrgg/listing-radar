import {_electron as electron,chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {streetSearchReady,openStreet} from './fixtures/street-search.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(root,'../.runtime/worker-street-table');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'territory-register-design-'));
const env={...process.env,TERRITORY_LAB_DATA_DIR:profile,TERRITORY_LAB_VISUAL_CHECK:'1'};delete env.ELECTRON_RUN_AS_NODE;
const errors=[];let app,browser,previewHtml='';
const assets=path.join(root,'dist-territory/territory/renderer');
const server=createServer(async(req,res)=>{try{if(req.url==='/__capture__.html'){res.setHeader('Content-Type','text/html');res.end(previewHtml);return;}const target=path.resolve(assets,'.'+decodeURIComponent(req.url));if(!target.startsWith(assets+path.sep))throw Error('Invalid path');const types={'.css':'text/css','.woff2':'font/woff2','.png':'image/png'};res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function capture(page,{path:filename}){
 // Re-render the actual Electron DOM with the identical shipped stylesheet in a
 // headless browser; hidden Windows windows can stall native GPU screenshots.
 previewHtml=(await page.content()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 browser??=await chromium.launch({channel:'chrome',headless:true});
 const preview=await browser.newPage({viewport:page.viewportSize()});
 await preview.route('https://**/*',route=>/tile.openstreetmap.org/.test(route.request().url())?route.continue():route.abort());
 await preview.goto(`http://127.0.0.1:${server.address().port}/__capture__.html`);
 await preview.evaluate(async()=>{for(const d of document.querySelectorAll('dialog[open]')){d.removeAttribute('open');d.show();}await document.fonts.ready;});
 await preview.waitForFunction(()=>[...document.querySelectorAll('#map img')].some(i=>i.complete&&i.naturalWidth>0),{},{timeout:8000}).catch(()=>{});await preview.evaluate(()=>document.querySelectorAll('#map img.leaflet-tile').forEach(i=>{if(i.complete&&i.naturalWidth)i.classList.add('leaflet-tile-loaded');}));await preview.screenshot({path:filename,animations:'disabled'});await preview.locator('#detail-dialog').screenshot({path:filename.replace('.png','-sidebar.png'),animations:'disabled'});await preview.close();
}

const sourceLedger=process.argv.find(arg=>arg.startsWith('--ledger='))?.slice(9);
if(!sourceLedger)throw Error('Supply --ledger=<read-only source ledger>; only a temporary copy is opened.');
const source=await readFile(sourceLedger,'utf8');JSON.parse(source);
await writeFile(path.join(profile,'territory-ledger.json'),source);
try{
 app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['--disable-gpu','--disable-renderer-backgrounding',path.join(root,'dist-territory/territory/main.js')],env});
 await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);BrowserWindow.getAllWindows()[0].setContentSize(1440,900);});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await streetSearchReady(page);await page.setViewportSize({width:1440,height:860});
 const street=await page.evaluate(async()=>(await window.territory.snapshot()).streets.find(s=>s.name==='VIA GORIZIA'));assert.ok(street);
 const detail=await page.evaluate(id=>window.territory.detail(id),street.id);
 const mapWidth=(await page.locator('#map').boundingBox()).width;
 await openStreet(page,street);await page.locator('.unit-table-row').first().waitFor();
 assert.equal(await page.locator('.unit-table-row').count(),detail.units.length);
 assert.equal((await page.locator('#map').boundingBox()).width,mapWidth);
 assert.equal(await page.locator('#detail-dialog').evaluate(el=>el.matches(':modal')),false);
 assert.equal(await page.locator('.unit-table-detail').count(),0);
 const firstY=(await page.locator('.unit-table-row').first().boundingBox()).y;
 assert.ok(firstY<300,'First record should appear before 300px: '+firstY);
 const visible=await page.locator('.unit-table-row').evaluateAll(rows=>rows.filter(r=>{const b=r.getBoundingClientRect();return b.top>=0&&b.bottom<innerHeight-64}).length);
 assert.ok(visible>=8,'At least eight records visible: '+visible);
 assert.equal(await page.locator('.street-settings').evaluate(el=>el.open),false);
 await writeFile(path.join(output,'via-gorizia.html'),await page.content());
 await capture(page,{path:path.join(output,'01-via-gorizia-tabella.png')});
 await page.locator('.street-settings > summary').click();
 assert.equal((await page.locator('.unit-table-row').first().boundingBox()).y,firstY,'Tools do not push records down');
 await page.locator('.street-settings > summary').click();
 await page.locator('[data-disclosure=unit-filters] > summary').click();
 assert.equal((await page.locator('.unit-table-row').first().boundingBox()).y,firstY,'Filters do not push records down');
 await page.locator('[data-disclosure=unit-filters] > summary').click();
 await page.locator('[data-unit-open]').first().click();
 assert.equal(await page.locator('.unit-table-detail').count(),1);
 await page.locator('.unit-table-detail [data-disclosure$=":owners"] > summary').click();
 await page.locator('.unit-table-detail .owner-name strong').first().waitFor();
 await capture(page,{path:path.join(output,'02-immobile-aperto.png')});
 await page.locator('[data-unit-open]').first().click();
 const scroll=page.locator('.unit-table-scroll');await scroll.evaluate(el=>el.scrollTop=500);
 await page.locator('#detail-refresh').click();await page.waitForTimeout(500);
 assert.ok(await scroll.evaluate(el=>el.scrollTop)>400,'Retains scroll position across refresh');
 for(const width of [1024,390]){
  await page.setViewportSize({width,height:860});await page.waitForTimeout(150);
  assert.equal(await page.locator('#detail-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'No page overflow '+width);
  assert.equal(await page.locator('.unit-table-row').count(),detail.units.length);
  assert.equal(await page.locator('.unit-table').isVisible(),true);
  await capture(page,{path:path.join(output,`03-tabella-${width}.png`)});
 }
 await page.setViewportSize({width:1440,height:860});await page.locator('#detail-close').click();
 await page.locator('#queue-manager').click();await page.locator('#queue-content .unit-table-row').first().waitFor();
 const queue=await page.evaluate(()=>window.territory.queue());
 assert.equal(await page.locator('#queue-content .unit-table-row').count(),Math.min(queue.entries.length,100));
 assert.equal(await page.locator('.unit-expanded').count(),0);
 assert.ok((await page.locator('#queue-content .unit-table-row').first().boundingBox()).y<300);
 await capture(page,{path:path.join(output,'04-coda-tabella.png')});
 const beforeSelection=await page.locator('.queue-selection strong').textContent();
 await page.locator('[data-unit-sort=address]').click();
 assert.equal(await page.locator('th:has([data-unit-sort=address])').getAttribute('aria-sort'),'descending');
 assert.equal(await page.locator('.queue-selection strong').textContent(),beforeSelection,'Sorting preserves selected keys');
 await page.locator('#queue-clear').click();await page.locator('#queue-content [data-unit-select]:not(:disabled)').first().check();
 await page.locator('#queue-continue').click();await page.locator('#queue-policy').waitFor();
 assert.equal(await page.locator('.queue-review .unit-table-row').count(),1);
 await capture(page,{path:path.join(output,'05-coda-riepilogo.png')});
 await page.locator('#queue-back').click();await page.locator('[data-unit-open]').first().click();
 assert.equal(await page.locator('.unit-expanded').count(),1);
 await capture(page,{path:path.join(output,'06-coda-dettaglio.png')});
 assert.deepEqual(errors,[]);
 const result={ok:true,readOnlyLedgerCopy:true,realStreet:street.name,properties:detail.units.length,firstRowY:firstY,visibleRows:visible,queueTable:true,queueSortPreservesSelection:true,queueReview:true,mapFullWidth:true,toolsOverlay:true,filtersOverlay:true,oneExpandedRecord:true,scrollPreserved:true,responsive:[1440,1024,390],errors};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(app)await app.close();if(browser)await browser.close();server.close();}
