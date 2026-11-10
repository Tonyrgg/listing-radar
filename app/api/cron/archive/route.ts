import {NextRequest,NextResponse}from'next/server';
import {getSupabaseServiceClient}from'@/lib/supabase/service';
import {maintainExternalArchive}from'@/lib/property-lifecycle/archive/maintenance';
export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({ok:false},{status:401});
 if(!process.env.PRISMA_ARCHIVE_DATABASE_URL)return NextResponse.json({ok:false,error:'Archive configuration missing'},{status:503});
 try{return NextResponse.json({ok:true,...await maintainExternalArchive(getSupabaseServiceClient(),{connection:process.env.PRISMA_ARCHIVE_DATABASE_URL,sourceUrl:process.env.NEXT_PUBLIC_SUPABASE_URL!})});}
 catch{return NextResponse.json({ok:false,error:'Archive maintenance incomplete; pending source preserved'},{status:503});}
}
