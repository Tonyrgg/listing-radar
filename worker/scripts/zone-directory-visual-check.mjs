import {_electron as electron} from 'playwright';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=await mkdtemp(path.join(os.tmpdir(),'zone-directory-'));
const output=path.join(root,'../.runtime/zone-directory-ui');await mkdir(output,{recursive:true});
const profile=path.join(directory,'territory'),desktop=path.join(directory,'desktop');await mkdir(profile);await mkdir(desktop);
let areas;
try{areas=JSON.parse(await readFile(path.join(root,'../.runtime/zone-areas-live.json'),'utf8'));}
catch{areas={fetchedAt:new Date().toISOString(),areas:[{id:'test-zone',name:'Zona di prova',color:'#9bac87',agentName:null,geometry:{type:'Polygon',coordinates:[[[16.67,41.09],[16.72,41.09],[16.72,41.14],[16.67,41.14],[16.67,41.09]]]}}]};}
await writeFile(path.join(profile,'work-areas.json'),JSON.stringify(areas));
const env={...process.env,WORKER_V2_TEST_ROOT:root,WORKER_V2_DESKTOP_TEST_DIR:desktop,TERRITORY_LAB_DATA_DIR:profile,WORKER_V2_SIMULATION:'1',SISTER_KEEPALIVE_ENABLED:'false',CHROME_CDP_URL:'http://127.0.0.1:65531'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(root,'scripts/fixtures/worker-v2-host.cjs')],env});const errors=[];
try{
 const shell=await app.firstWindow();await shell.locator('[data-scroll="worker-v2"]').click();
 let page;for(let i=0;i<100;i++){page=app.context().pages().find(p=>p.url().endsWith('/territory/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}assert.ok(page);page.on('pageerror',e=>errors.push(e.message));
 await page.locator('#zone-streets-open').click();await page.locator('[data-zone-filter]').first().waitFor();
 const data=await page.evaluate(()=>window.territory.zoneDirectory()),area=data.areas.find(a=>a.name.includes('Carmen')&&a.streetCount)||data.areas.find(a=>a.streetCount);
 assert.ok(area);await page.locator(`[data-zone-filter="${area.id}"]`).check();
 assert.equal(await page.locator('.zone-streets-group').count(),1);
 await page.locator('[data-zone-select]').check();assert.ok(parseInt(await page.locator('#zone-streets-selection').textContent())>0);
 for(const width of [1600,1024,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(output,`worker-${width}.png`)});assert.equal(await page.locator('#zone-streets-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);}
 await page.setViewportSize({width:1600,height:900});await page.locator('#zone-streets-add').click();await page.waitForFunction(()=>document.querySelector('#zone-streets-feedback').textContent.includes('aggiunte'));
 const queue=await page.evaluate(()=>window.territory.sisterQueue());assert.ok(queue.entries.length>0);assert.equal(queue.active,false);assert.equal((await page.evaluate(()=>window.territory.snapshot())).activeRun,null);
 await page.locator('[data-zone-select]').check();await page.locator('#zone-streets-add').click();await page.waitForFunction(()=>document.querySelector('#zone-streets-feedback').textContent.includes('già in coda'));
 assert.equal((await page.evaluate(()=>window.territory.sisterQueue())).entries.length,queue.entries.length);
 await page.locator('#zone-streets-queue').click();await page.locator('[data-sister-edit]').first().click();await page.locator('#sister-bulk-keyword').fill('RICERCA_TEST');await page.locator('#sister-bulk-form button').click();
 await page.getByText('RICERCA_TEST',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'worker-queue.png')});
 await page.locator('#sister-bulk-close').click();await page.locator('#zone-streets-open').click();await page.locator('[data-zone-filter]').first().waitFor();
 const mapWidth=await page.locator('#map').evaluate(el=>el.getBoundingClientRect().width);assert.equal(mapWidth,await page.evaluate(()=>innerWidth));
 const bounds=await page.locator('#zone-streets-dialog').boundingBox();await page.mouse.click(Math.max(1,bounds.x-10),bounds.y+20);await page.waitForFunction(()=>!document.querySelector('#zone-streets-dialog').open);
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'worker-result.json'),JSON.stringify({ok:true,queued:queue.entries.length,duplicateFree:true,notStarted:true,editableSearch:true,fullWidthMap:true,errors},null,2));console.log(`Zone e accodamento verificati su profilo isolato: ${queue.entries.length} vie, nessun avvio SISTER.`);
}catch(error){for(const [index,page]of app.context().pages().entries())await page.screenshot({path:path.join(output,`failure-${index}.png`)}).catch(()=>{});throw error;}finally{await app.close();}
