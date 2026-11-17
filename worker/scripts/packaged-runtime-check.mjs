import {spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const executable=path.join(root,'release/win-unpacked/Property Data Worker.exe');
const archive=path.join(root,'release/win-unpacked/resources/app.asar');
const cwd=await mkdtemp(path.join(os.tmpdir(),'packaged-runtime-'));
// Electron's own Node resolves ASAR modules; reject dependency fallbacks to the
// source checkout or host node_modules, which would hide an incomplete installer.
const program=`const p=require('node:path'),M=require('node:module');const root=${JSON.stringify(archive)};const resolve=M._resolveFilename;M._resolveFilename=function(...args){const target=resolve.apply(this,args);if(p.isAbsolute(target)&&!target.startsWith(root))throw Error('Dependency outside package: '+args[0]);return target;};const names=['@supabase/supabase-js','playwright','pino','dotenv','zod','xlsx'];for(const name of names)require(root+'/node_modules/'+name);console.log(JSON.stringify({packagedModules:names,hostDependencyFallback:false}));`;
const result=spawnSync(executable,['-e',program],{cwd,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
if(result.error||result.status!==0)throw Error('Packaged runtime check failed: '+(result.stderr||result.error?.message||result.stdout));
console.log(result.stdout.trim());
