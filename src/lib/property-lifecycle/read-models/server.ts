import "server-only";

import { PropertyLifecycleReadRepository } from "@/lib/property-lifecycle/read-models/repository";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export interface LifecycleViewResult<T> {
  available: boolean;
  data: T | null;
  message: string | null;
}

export function getPropertyLifecycleReadRepository() {
  return new PropertyLifecycleReadRepository(getSupabaseServiceClient());
}

export async function loadLifecycleView<T>(
  reader: (repository: PropertyLifecycleReadRepository) => Promise<T>,
): Promise<LifecycleViewResult<T>> {
  try {
    return {
      available: true,
      data: await reader(getPropertyLifecycleReadRepository()),
      message: null,
    };
  } catch (error) {
    return {
      available: false,
      data: null,
      message:
        error instanceof Error
          ? error.message
          : "Il modello Lifecycle V2 non è disponibile.",
    };
  }
}
