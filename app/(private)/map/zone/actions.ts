'use server';
import {revalidatePath} from 'next/cache';
import {requireUser} from '@/lib/auth';
import {getSupabaseServiceClient} from '@/lib/supabase/service';
import {saveWorkArea} from '@/lib/map/save-work-area';

export async function saveWorkAreaAction(input:unknown){
  await requireUser();
  const saved=await saveWorkArea(getSupabaseServiceClient(),input);
  revalidatePath('/map');
  revalidatePath('/map/zone');
  return saved;
}
