import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
export const PROJECT='coreimmobiliare-seller-e2e',API='http://127.0.0.1:55421',WEB='http://127.0.0.1:3149';
export const LOCAL_MIGRATION_EXCEPTIONS=[{file:'0030_remax_verified_projection_rollout.sql',reason:'Data-only activation requires historical primary evidence; REMAX remains disabled in this synthetic project.'}];
export function localMigration(name,sql){
 if(!LOCAL_MIGRATION_EXCEPTIONS.some(item=>item.file===name))return sql;
 // Only this dedicated project: never fabricate the production rollout evidence.
 // Refuse future schema changes instead of silently skipping them.
 if(!/Healthy known-publication verifier run required/.test(sql)||/\b(?:create|alter|drop)\s/i.test(sql))throw Error('LOCAL_ROLLOUT_EXCEPTION_CHANGED');
 return "-- Synthetic-only exception: historical REMAX activation is not exercised.\nbegin;\nupdate public.market_observer_sources set enabled=false,projections_enabled=false,missing_enabled=false where source_key='REMAX';\ncommit;\n";
}
export function isolatedConfig(source){
 const transformed=source.replace(/^project_id\s*=.*$/m,'project_id = "'+PROJECT+'"')
  .replace(/\b543([0-9]{2})\b/g,'554$1')
  .replace(/^site_url\s*=.*$/m,'site_url = "'+WEB+'"');
 // Baseline migrations configure storage.buckets: keep the real Storage schema.
 const disabled=new Set(['db.seed','realtime','studio','local_smtp','storage.s3_protocol','storage.vector','edge_runtime','analytics']);
 let section='';
 const config=transformed.split(/\r?\n/).map(line=>{
  const match=line.match(/^\[([^\]]+)\]/);if(match)section=match[1];
  if(disabled.has(section)&&/^enabled\s*=/.test(line))return 'enabled = false';
  if(section==='auth.email'&&/^enable_confirmations\s*=/.test(line))return 'enable_confirmations = false';
  return line;
 }).join('\n');
 if(!config.includes('project_id = "'+PROJECT+'"')||!config.includes('port = 55421')||!config.includes('port = 55422'))throw Error('ISOLATED_CONFIG_INVALID');
 return config;
}
export async function prepareLocalStack(repo){
 const workdir=path.join(repo,'.runtime','core-seller-e2e'),configFile=path.join(workdir,'supabase','config.toml');
 try{const prior=await readFile(configFile,'utf8');if(!prior.includes('project_id = "'+PROJECT+'"'))throw Error('Unexpected project in isolated directory');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(path.dirname(configFile),{recursive:true});
 await writeFile(configFile,isolatedConfig(await readFile(path.join(repo,'supabase','config.toml'),'utf8')));
 const migrations=path.join(workdir,'supabase','migrations');await mkdir(migrations,{recursive:true});
 for(const name of (await readdir(path.join(repo,'supabase','migrations'))).filter(name=>name.endsWith('.sql')))
  await writeFile(path.join(migrations,name),localMigration(name,await readFile(path.join(repo,'supabase','migrations',name),'utf8')));
 return workdir;
}
function localDockerReady(){
 const endpoint=spawnSync('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8',windowsHide:true});
 if(endpoint.status!==0||!(/^(npipe:|unix:)/.test(endpoint.stdout.trim())))return false;
 return spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8',windowsHide:true,timeout:15000}).status===0;
}
async function stackCli(repo,args){
 const binary=path.join(repo,'node_modules','supabase','dist','supabase.js');await access(binary);
 const workIndex=args.indexOf('--workdir'),cwd=workIndex>=0?args[workIndex+1]:repo;
 const result=spawnSync(process.execPath,[binary,...args],{cwd,encoding:'utf8',windowsHide:true,timeout:180000});
 if(result.status!==0)throw Error('LOCAL_SUPABASE_COMMAND_FAILED: '+args[0]); // Never print status keys or captured output.
 return result.stdout;
}
async function waitWeb(child){
 for(let i=0;i<90;i++){
  if(child.exitCode!==null)throw Error('LOCAL_NEXT_EXITED');
  try{const response=await fetch(WEB+'/login');if(response.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error('LOCAL_NEXT_NOT_READY');
}
export async function main(args=process.argv.slice(2)){
 if(args.some(arg=>arg!=='--run'))throw Error('Use no arguments to prepare, --run to test the isolated stack.');
 const repo=process.cwd(),workdir=await prepareLocalStack(repo);
 if(!args.includes('--run')){console.log(JSON.stringify({status:'prepared',project:PROJECT,workdir,api:API,web:WEB}));return;}
 if(!localDockerReady())throw Error('DOCKER_LOCAL_ENGINE_NOT_RUNNING: prepared only; no existing database reset or service enabled.');
 let next,started=false,browser;
 const output=path.join(repo,'.runtime','core-e2e-results',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});
 try{
  started=true; // Even a partially failed start is cleaned up for this dedicated project.
  await stackCli(repo,['start','--workdir',workdir,'--exclude','studio,realtime,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor']);
  await stackCli(repo,['migration','up','--local','--workdir',workdir]);
  const status=JSON.parse(await stackCli(repo,['status','--workdir',workdir,'--output','json']));
  const api=status.API_URL??status.api_url,anon=status.ANON_KEY??status.anon_key,service=status.SERVICE_ROLE_KEY??status.service_role_key;
  if(api!==API||!anon||!service)throw Error('ISOLATED_ENDPOINT_OR_KEYS_NOT_AVAILABLE');
  const call=async(url,key,body,method='POST')=>{
   const response=await fetch(API+url,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   const data=await response.json();if(!response.ok)throw Error('LOCAL_REQUEST_FAILED: '+response.status);return data;
  };
  const user=async()=>{
   const email='core-e2e-'+randomUUID()+'@example.test',password=randomUUID()+'aA1!';
   const created=await call('/auth/v1/admin/users',service,{email,password,email_confirm:true});
   const token=await call('/auth/v1/token?grant_type=password',anon,{email,password});
   return {id:created.id,email,password,token:token.access_token};
  };
  const first=await user(),second=await user(),intakeToken=randomUUID()+randomUUID();
  next=spawn(process.execPath,[path.join(repo,'node_modules','next','dist','bin','next'),'dev','-H','127.0.0.1','-p','3149'],
   {cwd:repo,env:{...process.env,NODE_ENV:'development',AUTH_REQUIRED:'true',AUTH_ALLOWED_EMAIL:'',NEXT_PUBLIC_SUPABASE_URL:API,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,SELLER_INTAKE_LOCAL_ENABLED:'true',SELLER_INTAKE_OWNER_ID:first.id,SELLER_INTAKE_TOKEN:intakeToken},stdio:'ignore',windowsHide:true});
  await waitWeb(next);
  const submission={externalId:'auth-'+randomUUID(),formVersion:'seller_v1',name:'Persona sintetica prova Auth',phone:'+390000000000',
   answers:{situation:'considering_sale',role:'owner',locality:'Bitonto',propertyType:'apartment',timing:'undecided'},
   callbackRequested:true,whatsappOptIn:false,privacyVersion:'LOCAL_E2E_ONLY',attribution:{source:'local_test'}};
  const send=body=>fetch(WEB+'/api/seller-intake',{method:'POST',headers:{Authorization:'Bearer '+intakeToken,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const created=await send(submission);if(created.status!==201)throw Error('INTAKE_CREATE_FAILED');
  const firstBody=await created.json(),id=firstBody.id;
  if(!id)throw Error('INTAKE_RESPONSE_ID_MISSING');
  if((await send(submission)).status!==200||(await send({...submission,name:'Corpo discordante'})).status!==409)throw Error('REPLAY_POLICY_FAILED');
  const rest=async(u,path,body)=>fetch(API+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:anon,Authorization:'Bearer '+u.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if((await(await rest(second,'seller_cases?select=id')).json()).length!==0)throw Error('RLS_SECOND_USER_LEAK');
  const review={p_id:id,p_revision:0,p_status:'IN_REVIEW',p_action:'VERIFY',p_at:new Date(Date.now()+3600000).toISOString(),p_note:'Revisione concorrente sintetica'};
  const concurrent=await Promise.all([rest(first,'rpc/review_seller_case',review),rest(first,'rpc/review_seller_case',review)]);
  if(concurrent.filter(r=>r.ok).length!==1)throw Error('CONCURRENT_REVIEW_FAILED');
  const denied=await rest(second,'rpc/review_seller_case',review);if(denied.ok)throw Error('RLS_REVIEW_LEAK');
  const {createServerClient}=await import('@supabase/ssr'),{chromium,expect}=await import('@playwright/test');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const cookies=[];
  const auth=createServerClient(API,anon,{cookies:{getAll:()=>[],setAll:values=>cookies.push(...values)}});
  const login=await auth.auth.signInWithPassword({email:first.email,password:first.password});if(login.error)throw Error('AUTH_COOKIE_SIGNIN_FAILED');
  const context=await browser.newContext({viewport:{width:1024,height:900},timezoneId:'Europe/Rome'});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:WEB,sameSite:'Lax'})));
  const page=await context.newPage();await page.goto(WEB+'/richieste',{waitUntil:'networkidle'});
  const card=page.locator('article').filter({hasText:submission.name});await card.waitFor();
  await card.getByText('Registra un esito',{exact:true}).click();
  await card.getByLabel('Esito / stato').selectOption('CONTACTED');await card.getByLabel('Prossimo passo').selectOption('FOLLOW_UP');
  await card.getByLabel('Quando (orario del dispositivo)').fill(new Date(Date.now()+86400000).toISOString().slice(0,10)+'T12:00');
  await card.getByLabel('Che cosa hai verificato o concordato?').fill('Colloquio sintetico tramite Server Action autentica');
  await card.getByRole('button',{name:'Registra esito e prossimo passo'}).click();
  await expect.poll(async()=>{
   const rows=await(await rest(first,'seller_cases?id=eq.'+id+'&select=status,revision')).json();
   return rows[0];
  },{timeout:15000}).toMatchObject({status:'CONTACTED',revision:2});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('article').filter({hasText:submission.name}).locator('span').filter({hasText:/^Contatto avvenuto$/}).waitFor();
  await page.screenshot({path:path.join(output,'auth-workbench.png'),fullPage:true});
  const own=await(await rest(first,'seller_cases?id=eq.'+id+'&select=revision')).json();
  const close=await rest(first,'rpc/review_seller_case',{p_id:id,p_revision:own[0].revision,p_status:'DO_NOT_CONTACT',p_action:'NONE',p_at:null,p_note:'Opposizione sintetica Auth'});
  if(!close.ok)throw Error('SUPPRESSION_FAILED');
  if((await send(submission)).status!==200)throw Error('SUPPRESSION_REPLAY_RESPONSE_FAILED');
  const outbox=await(await rest(first,'seller_delivery_outbox?case_id=eq.'+id+'&select=status,channel')).json();
  if(!Array.isArray(outbox)||outbox.length!==1||outbox[0].channel!=='OPERATOR'||outbox[0].status!=='CANCELLED')throw Error('SUPPRESSION_REPLAY_FAILED');
  const report={project:PROJECT,auth:true,rest:true,nextServerAction:true,rlsTwoUsers:true,idempotentIntake:true,concurrentReview:true,suppression:true,syntheticOnly:true,migrationExceptions:LOCAL_MIGRATION_EXCEPTIONS,payloadHash:createHash('sha256').update(submission.externalId).digest('hex')};
  await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{
  await browser?.close();
  if(next?.pid&&next.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(next.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else next.kill();}
  if(started)try{await stackCli(repo,['stop','--workdir',workdir]);}catch{console.error('LOCAL_TEST_STACK_CLEANUP_REQUIRED: '+PROJECT);process.exitCode=2;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 main().catch(error=>{console.error(error.message);process.exitCode=2;});
