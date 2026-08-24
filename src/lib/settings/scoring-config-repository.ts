import "server-only";

import {
  getDefaultScoringConfig,
  normalizeScoringConfig,
  type ScoringConfig,
} from "@/lib/listings/scoring-config";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const SCORING_CONFIG_KEY = "scoring_config";

function hasSupabaseWriteConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export async function getPersistedScoringConfig(): Promise<ScoringConfig> {
  if (!hasSupabaseWriteConfig()) {
    return getDefaultScoringConfig();
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SCORING_CONFIG_KEY)
      .maybeSingle();

    if (error || !data) {
      return getDefaultScoringConfig();
    }

    return normalizeScoringConfig(data.value as Partial<ScoringConfig>);
  } catch {
    return getDefaultScoringConfig();
  }
}

export async function savePersistedScoringConfig(config: ScoringConfig) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("app_settings").upsert({
    key: SCORING_CONFIG_KEY,
    value: config,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error("Impossibile salvare le regole di appetibilità.");
  }
}
