import { HttpClient } from "@/lib/http/client";
import type { SourceDocument } from "@/lib/property-lifecycle/adapters/types";
import {
  TROVACASA_BASE_URL,
  TrovaCasaPortalAdapter,
  normalizeTrovaCasaDetail,
  parseTrovaCasaInventoryHtml,
  type TrovaCasaAgencyProfile,
} from "@/lib/property-lifecycle/adapters/trovacasa";

export const MOMENTO_BASE_URL = TROVACASA_BASE_URL;
export const MOMENTO_AGENCY_PATH =
  "/agenzie-immobiliari/momento-casa-bitonto-tc-96100";
export const MOMENTO_INVENTORY_URL =
  `${MOMENTO_BASE_URL}${MOMENTO_AGENCY_PATH}/case-in-vendita`;

const MOMENTO_PROFILE: TrovaCasaAgencyProfile = {
  adapterKey: "momento",
  agencySlug: "momento-casa-bitonto",
  agencyDisplayName: "MOMENTO CASA",
  agencyId: "96100",
  agencyPath: MOMENTO_AGENCY_PATH,
  inventoryUrl: MOMENTO_INVENTORY_URL,
};

export function parseMomentoInventoryHtml(
  html: string,
  response: Parameters<typeof parseTrovaCasaInventoryHtml>[2] = null,
) {
  return parseTrovaCasaInventoryHtml(html, MOMENTO_PROFILE, response);
}

export function normalizeMomentoDetail(document: SourceDocument) {
  return normalizeTrovaCasaDetail(document, MOMENTO_PROFILE);
}

export class MomentoAdapter extends TrovaCasaPortalAdapter {
  constructor(http?: HttpClient) {
    super(MOMENTO_PROFILE, http);
  }
}
