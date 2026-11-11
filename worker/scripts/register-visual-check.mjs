import {_electron as electron,chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {streetSearchReady,openStreet} from './fixtures/street-search.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(root,'../.runtime/worker-register-design');await mkdir(output,{recursive:true});
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
 await preview.route('https://**/*',route=>route.abort());
 await preview.goto(`http://127.0.0.1:${server.address().port}/__capture__.html`);
 await preview.evaluate(async()=>{for(const d of document.querySelectorAll('dialog[open]')){d.removeAttribute('open');d.showModal();}await document.fonts.ready;});
 await preview.screenshot({path:filename,animations:'disabled'});await preview.close();
}
try{
 app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['--disable-gpu','--disable-renderer-backgrounding',path.join(root,'dist-territory/territory/main.js')],env});
 await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.setBackgroundThrottling(false);});
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setContentSize(1440,900);});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await streetSearchReady(page);await page.setViewportSize({width:1440,height:860});
 const street=await page.evaluate(async()=>{const s=await window.territory.snapshot();return s.streets.find(x=>x.geometry&&!x.needsReview&&x.name.includes('CASTELLUCCI'));});assert.ok(street);
 await openStreet(page,street);assert.equal(await page.locator('[data-operation=scan]').isVisible(),true);await page.locator('#detail-close').click();
 await page.evaluate(id=>window.territory.start({streetId:id,operation:'scan'}),street.id);
 await page.waitForFunction(async()=>!(await window.territory.snapshot()).activeRun,{},{timeout:20000});
 await openStreet(page,street);await page.locator('.unit-register').first().waitFor();
 assert.ok(await page.locator('.unit-register').count()>=3);
 await writeFile(path.join(output,'street.html'),await page.content());
 await capture(page,{animations:'disabled',timeout:30000,path:path.join(output,'02-via-immobili.png')});
 const first=page.locator('.unit-register').first();await first.locator('[data-unit-select]').check();
 assert.equal(await first.getAttribute('data-selected'),'true');
 await first.locator('details').first().locator('summary').click();await first.locator('.owner-name strong').first().waitFor();
 await capture(page,{animations:'disabled',timeout:30000,path:path.join(output,'03-intestatari.png')});await first.locator('details').first().locator('summary').click();
 await page.locator('#enqueue').click();await page.locator('#detail-close').click();await page.locator('#queue-manager').click();await page.locator('#queue-content').waitFor();
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:860});
  assert.equal(await page.evaluate(()=>document.querySelector('#detail-dialog').scrollWidth>document.querySelector('#detail-dialog').clientWidth+1),false,'Queue overflow '+width);
  await capture(page,{animations:'disabled',timeout:30000,path:path.join(output,`04-coda-${width}.png`)});
 }
 await page.setViewportSize({width:1440,height:860});await page.locator('#queue-continue').click();await page.locator('#queue-policy').waitFor();
 await capture(page,{animations:'disabled',timeout:30000,path:path.join(output,'05-riepilogo.png')});
 await page.locator('#detail-close').click();await page.locator('#query-manager').click();await page.locator('#query-results .unit-register').first().waitFor();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:860});
  assert.equal(await page.evaluate(()=>document.querySelector('#detail-dialog').scrollWidth>document.querySelector('#detail-dialog').clientWidth+1),false,'Query overflow '+width);
  await capture(page,{animations:'disabled',timeout:30000,path:path.join(output,`06-query-${width}.png`)});
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,profile,output,errors}));
 await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,isolatedSimulation:true,street:true,owners:true,selection:true,queue:true,review:true,queries:true,widths:[1440,1024,390],errors},null,2));
}finally{if(app)await app.close();if(browser)await browser.close();server.close();}
