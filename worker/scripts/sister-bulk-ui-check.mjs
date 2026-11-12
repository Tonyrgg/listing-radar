import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(),temp=await mkdtemp(path.join(os.tmpdir(),'sister-bulk-ui-'));
await mkdir(path.join(temp,'desktop'));await mkdir('../.runtime/sister-bulk-ui',{recursive:true});
const env={...process.env,WORKER_V2_TEST_ROOT:root,WORKER_V2_DESKTOP_TEST_DIR:path.join(temp,'desktop'),TERRITORY_LAB_DATA_DIR:path.join(temp,'territory'),WORKER_V2_SIMULATION:'1',SISTER_KEEPALIVE_ENABLED:'false',CHROME_CDP_URL:'http://127.0.0.1:65531'};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.join(root,'scripts/fixtures/worker-v2-host.cjs')],env});
try {
 const shell=await app.firstWindow();await shell.locator('[data-scroll="worker-v2"]').click();
 let page;for(let i=0;i<100;i++){page=app.context().pages().find(p=>p.url().endsWith('/territory/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector('#search')?.disabled===false);
 await page.locator('#sister-bulk-open').click();
 for(const name of ['VIA GORIZIA','VIA GIOTTO']) {
   const value=await page.locator('#sister-bulk-streets option').evaluateAll((options,name)=>options.find(o=>o.value.toUpperCase().startsWith(name+' ·'))?.value,name);
   assert.ok(value,name);await page.locator('#sister-bulk-street').fill(value);await page.locator('#sister-bulk-street').dispatchEvent('change');
   await page.locator('#sister-bulk-keyword').fill(name.slice(4));await page.locator('#sister-bulk-name').fill(name);
   await page.locator('#sister-bulk-form button').click();await page.waitForTimeout(200);
 }
 await page.locator('#sister-bulk-start').click();
 await page.waitForFunction(()=>document.querySelector('#sister-bulk-summary').textContent.includes('2/2'),{},{timeout:30000});
 await page.screenshot({path:'../.runtime/sister-bulk-ui/desktop.png'});
 assert.equal(await page.locator('#sister-bulk-rows tr').count(),2);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,streets:2,completed:2,errors}));
} finally {await app.close();}
