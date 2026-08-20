import { HttpClient } from "@/lib/http/client";
import type { SourceDocument } from "@/lib/property-lifecycle/adapters/types";
import {
  TROVACASA_BASE_URL,
  TrovaCasaPortalAdapter,
  normalizeTrovaCasaDetail,
  parseTrovaCasaInventoryHtml,
  type TrovaCasaAgencyProfile,
} from "@/lib/property-lifecycle/adapters/trovacasa";

export const TRIO_BASE_URL = TROVACASA_BASE_URL;
export const TRIO_AGENCY_PATH =
  "/agenzie-immobiliari/trio-casa-s-a-s-bitonto-tc-92459";
export const TRIO_INVENTORY_URL = `${TRIO_BASE_URL}${TRIO_AGENCY_PATH}/case-in-vendita`;

const TRIO_PROFILE: TrovaCasaAgencyProfile = {
  adapterKey: "trio",
  agencySlug: "trio-casa-bitonto",
  agencyDisplayName: "Trio Casa S.A.S.",
  agencyId: "92459",
  agencyPath: TRIO_AGENCY_PATH,
  inventoryUrl: TRIO_INVENTORY_URL,
};

export function parseTrioInventoryHtml(
  html: string,
  response: Parameters<typeof parseTrovaCasaInventoryHtml>[2] = null,
) {
  return parseTrovaCasaInventoryHtml(html, TRIO_PROFILE, response);
}

export function normalizeTrioDetail(document: SourceDocument) {
  return normalizeTrovaCasaDetail(document, TRIO_PROFILE);
}

export class TrioAdapter extends TrovaCasaPortalAdapter {
  constructor(http?: HttpClient) {
    super(TRIO_PROFILE, http);
  }
}
