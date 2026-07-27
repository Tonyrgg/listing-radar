import type { PortfolioProperty, PropertyRequest } from "./types";

export type PropertyRequestImport = Omit<PropertyRequest, "id"> & { external_crm_id?: string };
export type PortfolioPropertyImport = Omit<PortfolioProperty, "id"> & { external_crm_id?: string };

export interface OfficeDatabaseImporter {
  parseRequests(input: unknown): Promise<PropertyRequestImport[]>;
  parseProperties(input: unknown): Promise<PortfolioPropertyImport[]>;
}

export class MockOfficeDatabaseImporter implements OfficeDatabaseImporter {
  async parseRequests(input: unknown) {
    return Array.isArray(input) ? input as PropertyRequestImport[] : [];
  }
  async parseProperties(input: unknown) {
    return Array.isArray(input) ? input as PortfolioPropertyImport[] : [];
  }
}

