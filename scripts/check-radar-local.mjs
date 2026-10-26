import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isolatedConfig,localMigration,LOCAL_MIGRATION_EXCEPTIONS,PROJECT as SELLER_PROJECT} from './check-seller-auth-local.mjs';

export const RADAR_PROJECT='coreimmobiliare-radar-e2e';
export const RADAR_API='http://127.0.0.1:55521';
const excluded='studio,realtime,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor';
const RADAR_WEB='http://127.0.0.1:3150';

export function radarLocalConfig(source){
 const config=isolatedConfig(source).replaceAll(SELLER_PROJECT,RADAR_PROJECT).replace(/\b554([0-9]{2})\b/g,'555$1');
 if(!config.includes('project_id = "'+RADAR_PROJECT+'"')||!config.includes('port = 55521')||!config.includes('port = 55522'))throw Error('RADAR_ISOLATION_INVALID');
 return config;
}

function run(command,args,{cwd,env=process.env,print=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(print)process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>{stderr+=chunk;if(print)process.stderr.write(chunk);});
  child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,stderr}));
 });
}

async function checkUi(repo,workdir,{api,service,anon}){
 const {createClient}=await import('@supabase/supabase-js');
 const {createServerClient}=await import('@supabase/ssr');
 const {chromium,expect}=await import('@playwright/test');
 const admin=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const email='radar-ui-'+randomUUID()+'@example.test',password=randomUUID()+'aA1!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(created.error)throw Error('RADAR_UI_USER_FAILED');
 let next,browser;
 try{
  next=spawn(process.execPath,[path.join(repo,'node_modules','next','dist','bin','next'),'dev','-H','127.0.0.1','-p','3150'],{
   cwd:repo,env:{...process.env,NODE_ENV:'development',AUTH_REQUIRED:'true',AUTH_ALLOWED_EMAIL:'',NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service},stdio:'ignore',windowsHide:true});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
   if(next.exitCode!==null)throw Error('RADAR_LOCAL_WEB_EXITED');
   try{const response=await fetch(RADAR_WEB+'/login',{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw Error('RADAR_LOCAL_WEB_NOT_READY');
  const denied=await fetch(RADAR_WEB+'/fonti/pratiche',{redirect:'manual'});
  if(![307,308].includes(denied.status)||!denied.headers.get('location')?.includes('/login'))throw Error('RADAR_UI_PRIVATE_ROUTE_FAILED');
  const cookies=[];
  const auth=createServerClient(api,anon,{cookies:{getAll:()=>[],setAll:values=>cookies.push(...values)}});
  const signed=await auth.auth.signInWithPassword({email,password});if(signed.error)throw Error('RADAR_UI_SIGNIN_FAILED');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:900},timezoneId:'Europe/Rome'});
  await context.addCookies(cookies.map(cookie=>({name:cookie.name,value:cookie.value,url:RADAR_WEB,sameSite:'Lax'})));
  const page=await context.newPage();
  await page.goto(RADAR_WEB+'/fonti/pratiche?tipo=tutte',{waitUntil:'networkidle'});
  await expect(page.getByRole('heading',{name:'Pratiche e documenti',exact:true})).toBeVisible();
  await expect(page.getByText('La coda documenti non è disponibile')).toHaveCount(0);
  await expect(page.getByText(/Registro APE/).first()).toBeVisible();
  await page.getByLabel('Documento',{exact:true}).selectOption('LINKED');
  await page.getByRole('button',{name:'Filtra',exact:true}).click();
  await page.waitForURL(/stato=LINKED/);
  await expect(page.getByText('La coda documenti non è disponibile')).toHaveCount(0);
  await page.screenshot({path:path.join(workdir,'practice-documents.png'),fullPage:true});
  await page.goto(RADAR_WEB+'/fonti',{waitUntil:'networkidle'});
  await expect(page.getByRole('link',{name:'Pratiche e documenti da approfondire'})).toBeVisible();
  return {auth:true,privateRoute:true,queue:true,filters:true,sourcesNavigation:true};
 }finally{
  await browser?.close();
  if(next?.pid&&next.exitCode===null){
   if(process.platform==='win32')await run('taskkill',['/PID',String(next.pid),'/T','/F'],{cwd:repo});else next.kill();
  }
  await admin.auth.admin.deleteUser(created.data.user.id);
 }
}

export async function main(args=process.argv.slice(2)){
 if(args.some(arg=>!['--prepare','--keep-running','--ui'].includes(arg)))throw Error('Use --prepare, --keep-running or --ui.');
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const workdir=path.join(repo,'.runtime','radar-e2e'),root=path.join(workdir,'supabase');
 await mkdir(path.join(root,'migrations'),{recursive:true});
 const configFile=path.join(root,'config.toml');
 try{if(!(await readFile(configFile,'utf8')).includes('project_id = "'+RADAR_PROJECT+'"'))throw Error('Unexpected project in Radar workdir');}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(configFile,radarLocalConfig(await readFile(path.join(repo,'supabase','config.toml'),'utf8')));
 for(const name of (await readdir(path.join(repo,'supabase','migrations'))).filter(name=>name.endsWith('.sql'))){
  await writeFile(path.join(root,'migrations',name),localMigration(name,await readFile(path.join(repo,'supabase','migrations',name),'utf8')));
 }
 if(args.includes('--prepare')){console.log(JSON.stringify({project:RADAR_PROJECT,api:RADAR_API,status:'prepared'}));return;}
 const cli=path.join(repo,'node_modules','supabase','dist','supabase.js');await access(cli);
 const context=await run('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{cwd:repo});
 if(context.code!==0||!/^(npipe:|unix:)/.test(context.stdout.trim()))throw Error('Local Docker engine required');
 const cliRun=async commands=>{
  const result=await run(process.execPath,[cli,...commands,'--workdir',workdir],{cwd:workdir});
  if(result.code!==0){
   // Do not print CLI status output: it contains local service keys.
   const message=result.stderr.match(/ERROR:[^\r\n]+/)?.[0];
   throw Error('RADAR_SUPABASE_'+commands[0].toUpperCase()+'_FAILED'+(message?': '+message:''));
  }
  return result.stdout;
 };
 let started=false;
 try{
  started=true;
  console.log('Radar: avvio Supabase isolato su 55521.');
  await cliRun(['start','--exclude',excluded]);
  console.log('Radar: applicazione delle migrazioni locali.');
  await cliRun(['migration','up','--local']);
  const status=JSON.parse(await cliRun(['status','--output','json']));
  const api=status.API_URL??status.api_url,service=status.SERVICE_ROLE_KEY??status.service_role_key,anon=status.ANON_KEY??status.anon_key;
  if(api!==RADAR_API||!service||!anon)throw Error('RADAR_LOCAL_ENDPOINT_INVALID');
  let schemaReady=false;
  for(let attempt=0;attempt<30;attempt++){
   try{const response=await fetch(api+'/rest/v1/market_observer_practice_document_queue?select=index_record_id&limit=0',{headers:{apikey:service,Authorization:'Bearer '+service},signal:AbortSignal.timeout(3000)});if(response.ok){schemaReady=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!schemaReady)throw Error('RADAR_POSTGREST_SCHEMA_NOT_READY');
  const vitest=path.join(repo,'node_modules','vitest','vitest.mjs');
  console.log('Radar: test su PostgREST e database locale.');
  const tested=await run(process.execPath,[vitest,'run','tests/integration/radar-sources-local.test.ts'],{cwd:repo,
   env:{...process.env,PROPERTY_LIFECYCLE_TEST_SUPABASE_URL:api,PROPERTY_LIFECYCLE_TEST_SERVICE_ROLE_KEY:service,PROPERTY_LIFECYCLE_TEST_ANON_KEY:anon,RADAR_TEST_PROJECT:RADAR_PROJECT},print:true});
  if(tested.code!==0)throw Error('RADAR_DATABASE_TESTS_FAILED');
  const ui=args.includes('--ui')?await checkUi(repo,workdir,{api,service,anon}):undefined;
  const report={project:RADAR_PROJECT,api,checkedAt:new Date().toISOString(),migrations:'current',databaseTests:'passed',...(ui?{ui}:{}),syntheticOnly:true,migrationExceptions:LOCAL_MIGRATION_EXCEPTIONS};
  await writeFile(path.join(workdir,'last-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{
  if(started&&!args.includes('--keep-running'))await cliRun(['stop']);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(error=>{console.error(error.message);process.exitCode=1;});
