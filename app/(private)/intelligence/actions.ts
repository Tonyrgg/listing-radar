"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, getCurrentUser } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { LIFECYCLE_CACHE_TAG } from "@/lib/property-lifecycle/read-models/server";

export async function linkMarketOpportunity(form: FormData) {
  await requireUser();
  const id=z.uuid().parse(form.get("opportunity_id"));
  const user=await getCurrentUser();
  const {data,error}=await getSupabaseServiceClient().rpc("acquisition_link_market_opportunity", {
    p_opportunity_id:id,p_actor_id:user?.id ?? null,
  });
  if(error) throw new Error(error.message);
  if(typeof data !== "string") throw new Error("Il collegamento commerciale non è stato confermato.");
  revalidateTag(LIFECYCLE_CACHE_TAG,{expire:0});
  revalidatePath("/acquisition");
  revalidatePath("/intelligence");
  redirect(`/acquisition/${data}`);
}
