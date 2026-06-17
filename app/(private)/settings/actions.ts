"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  normalizeScoringConfig,
  type ScoringConfig,
} from "@/lib/listings/scoring-config";
import { savePersistedScoringConfig } from "@/lib/settings/scoring-config-repository";

function readNumber(formData: FormData, key: keyof ScoringConfig) {
  const parsed = Number(String(formData.get(key) ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function saveScoringConfig(formData: FormData) {
  await requireUser();

  const config = normalizeScoringConfig({
    privateSeller: readNumber(formData, "privateSeller"),
    agencySeller: readNumber(formData, "agencySeller"),
    unknownSeller: readNumber(formData, "unknownSeller"),
    newToday: readNumber(formData, "newToday"),
    visiblePhone: readNumber(formData, "visiblePhone"),
    online60Days: readNumber(formData, "online60Days"),
    online120Days: readNumber(formData, "online120Days"),
    priceDrop: readNumber(formData, "priceDrop"),
    negotiablePrice: readNumber(formData, "negotiablePrice"),
    noAgencies: readNumber(formData, "noAgencies"),
    missingPrice: readNumber(formData, "missingPrice"),
    missingSqm: readNumber(formData, "missingSqm"),
    missingDescription: readNumber(formData, "missingDescription"),
    auction: readNumber(formData, "auction"),
    highPriorityThreshold: readNumber(formData, "highPriorityThreshold"),
  });

  await savePersistedScoringConfig(config);

  revalidatePath("/settings");
  revalidatePath("/listings");
  revalidatePath("/dashboard");
}
