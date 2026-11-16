import {_electron as electron} from 'playwright';import {mkdtemp,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const profile=await mkdtemp(path.join(os.tmpdir(),'packaged-worker-v2-'));
const env={...process.env,PACKAGED_TEST_PROFILE:profile,PACKAGED_TEST_ROOT:root,PACKAGED_TEST_ASSETS:path.join(root,'release/win-unpacked/resources/territory')};delete env.ELECTRON_RUN_AS_NODE;
const application=await electron.launch({args:[path.join(root,'scripts/fixtures/packaged-territory-host.cjs')],env});
const failures=[];
try{const page=await application.firstWindow();page.on('pageerror',e=>failures.push(e.message));page.on('requestfailed',r=>{if(r.url().startsWith('file:'))failures.push(r.url()+': '+r.failure()?.errorText);});
 await page.waitForFunction(()=>window.territory&&document.querySelector('#map')?.classList.contains('leaflet-container')&&!document.querySelector('#search')?.disabled,{},{timeout:20000});
 const result=await page.evaluate(async()=>{const s=await window.territory.snapshot();return{streets:s.streets.length,mapLoaded:!!document.querySelector('#map canvas'),searchEnabled:!document.querySelector('#search').disabled};});
 if(!result.streets||!result.mapLoaded||failures.length)throw Error(JSON.stringify({result,failures}));
 await page.locator('#zone-streets-open').click();await page.locator('#zone-streets-dialog[open]').waitFor();await page.locator('#zone-streets-count').filter({hasText:/vie/}).waitFor();await mkdir(path.join(root,'../.runtime/packaged-worker-v2'),{recursive:true});await page.screenshot({path:path.join(root,'../.runtime/packaged-worker-v2/desktop.png')});
 console.log(JSON.stringify({...result,zoneDirectoryOpened:true,failures}));
}finally{await application.close();}
