export interface SisterSelectors {
  resultsPageMarker: string;
  addressListMarker: string;
  sessionExpiredMarker: string;
  searchContext: string;
  municipality: string;
  street: string;
  civicNumber: string;
  resultsTable: string;
  propertyRows: string;
  sheet: string;
  parcel: string;
  subaltern: string;
  address: string;
  censusZone: string;
  category: string;
  class: string;
  consistency: string;
  cadastralIncome: string;
  ownersWithinRow: string;
  propertyRadioWithinRow: string;
  ownersButton: string;
  ownersPageMarker: string;
  ownersTable: string;
  ownerRows: string;
  ownerPersonalData: string;
  ownerTaxCode: string;
  ownerRightType: string;
  ownerShare: string;
  ownersBackButton: string;
}

/**
 * Production selectors intentionally stay blank until verified against the authenticated
 * SISTER results page. Keep every selector here; do not add portal selectors to services.
 * Prefer stable data attributes/table headers and semantic text over generated IDs.
 */
export const sisterSelectors: SisterSelectors = {
  resultsPageMarker: 'form[name="SceltaVisuraImmSoggForm"] table.listaIsp4 input[name="visImmSel"]',
  addressListMarker: 'form[name="SceltaIndirizzoForm"] select[name="indirizzoSel"]',
  sessionExpiredMarker: 'input[type="password"]',
  searchContext: 'fieldset:has(legend:text-is("Dati della ricerca"))',
  municipality: "",
  street: "",
  civicNumber: "",
  resultsTable: 'form[name="SceltaVisuraImmSoggForm"] table.listaIsp4',
  propertyRows: 'form[name="SceltaVisuraImmSoggForm"] table.listaIsp4 tr:has(input[name="visImmSel"])',
  sheet: ":scope > td:nth-child(2)",
  parcel: ":scope > td:nth-child(3)",
  subaltern: ":scope > td:nth-child(4)",
  address: ":scope > td:nth-child(5)",
  censusZone: ":scope > td:nth-child(6)",
  category: ":scope > td:nth-child(7)",
  class: ":scope > td:nth-child(8)",
  consistency: ":scope > td:nth-child(9)",
  cadastralIncome: ":scope > td:nth-child(10)",
  ownersWithinRow: "",
  propertyRadioWithinRow: 'input[name="visImmSel"]',
  ownersButton: 'form[name="SceltaVisuraImmSoggForm"] input[name="intestati"]',
  ownersPageMarker: 'form[name="SceltaIntestatiForm"] table.listaIsp4 tr:has(input[name="intestatoSelezionato"])',
  ownersTable: 'form[name="SceltaIntestatiForm"] table.listaIsp4',
  ownerRows: 'table.listaIsp4 tr:has(input[name="intestatoSelezionato"])',
  ownerPersonalData: ":scope > td:nth-child(2)",
  ownerTaxCode: ":scope > td:nth-child(3)",
  ownerRightType: ":scope > td:nth-child(4)",
  ownerShare: ":scope > td:nth-child(5)",
  ownersBackButton: 'form[name="SceltaVisuraImmSoggForm"] input[name="indietro"]',
};

export const sisterFixtureSelectors: SisterSelectors = {
  resultsPageMarker: '[data-worker-page="sister-results"]',
  addressListMarker: '[data-worker-page="sister-address-list"]',
  sessionExpiredMarker: '[data-worker-page="session-expired"]',
  searchContext: "",
  municipality: '[data-worker-field="municipality"]',
  street: '[data-worker-field="street"]',
  civicNumber: '[data-worker-field="civic-number"]',
  resultsTable: "",
  propertyRows: '[data-worker-row="property"]',
  sheet: '[data-worker-field="sheet"]',
  parcel: '[data-worker-field="parcel"]',
  subaltern: '[data-worker-field="subaltern"]',
  address: '[data-worker-field="address"]',
  censusZone: '[data-worker-field="census-zone"]',
  category: '[data-worker-field="category"]',
  class: '[data-worker-field="class"]',
  consistency: '[data-worker-field="consistency"]',
  cadastralIncome: '[data-worker-field="cadastral-income"]',
  ownersWithinRow: '[data-worker-owner]',
  propertyRadioWithinRow: "",
  ownersButton: "",
  ownersPageMarker: "",
  ownersTable: "",
  ownerRows: "",
  ownerPersonalData: "",
  ownerTaxCode: "",
  ownerRightType: "",
  ownerShare: "",
  ownersBackButton: "",
};
