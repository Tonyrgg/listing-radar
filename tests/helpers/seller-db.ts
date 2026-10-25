import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const owner='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
export const syntheticSubmission={externalId:'fixture',formVersion:'seller_v1',name:'Persona sintetica',phone:'+390000000000',answers:{situation:'considering_sale',role:'owner',locality:'Bitonto',propertyType:'apartment',timing:'undecided'},callbackRequested:true,whatsappOptIn:false,privacyVersion:'LOCAL_ONLY',attribution:{source:'local_test'}};
export async function sellerDb(migrations:string[]) {
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;grant usage on schema auth to authenticated,service_role;create table auth.users(id uuid primary key);create table public.properties(id uuid primary key);');
 await db.query('insert into auth.users values($1),($2)',[owner,other]);
 await db.exec("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.assert_public_news_candidate(p_id uuid) returns void language sql as $$select null::void$$;create table public.public_record_news_feedback(candidate_id uuid,user_id uuid,status text,source_signature text);");
 for(const file of ['0046_seller_workbench.sql',...migrations])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 return db;
}
export async function login(db:PGlite,id=owner) {await db.exec("reset role;set role authenticated;set request.jwt.claim.sub='"+id+"';");}
export async function inbound(db:PGlite,id='fixture',source='local_test',campaign?:string) {
 const submission={...syntheticSubmission,externalId:id,attribution:{source,...(campaign?{campaignId:campaign}:{})}};
 const result=await db.query<{v:{id:string}}>('select receive_seller_submission($1,$2,$3,$4::jsonb) as v',[owner,source+':'+id,'a'.repeat(64),JSON.stringify(submission)]);
 return result.rows[0].v.id;
}
