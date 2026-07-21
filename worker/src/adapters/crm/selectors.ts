export interface CrmSelectors {
  pageMarker: string;
  sessionExpiredMarker: string;
  unexpectedError: string;
  personSearchPage: string;
  personSearchTaxCode: string;
  personSearchPhone: string;
  personSearchSubmit: string;
  personResultRows: string;
  personResultId: string;
  personResultLabel: string;
  personResultOpen: string;
  personCreate: string;
  personFullName: string;
  personBirthPlace: string;
  personBirthProvince: string;
  personBirthDate: string;
  personTaxCode: string;
  personMobile: string;
  personOfficePhone: string;
  personOtherPhone: string;
  personEmail: string;
  personSave: string;
  recordId: string;
  propertySearchPage: string;
  propertyFiltersOpen: string;
  propertySearchSheet: string;
  propertySearchParcel: string;
  propertySearchSubaltern: string;
  propertySearchSubmit: string;
  propertyResultRow: string;
  propertyResultId: string;
  propertyResultOpen: string;
  propertyCreate: string;
  propertyAddress: string;
  propertyCategory: string;
  propertyClass: string;
  propertyConsistency: string;
  propertyIncome: string;
  propertySave: string;
  ownerPersonId: string;
  ownerShare: string;
  ownerSave: string;
  personResultsReady: string;
  personRelatedTab: string;
  personPropertiesCard: string;
  personPropertyLinks: string;
  propertySheetValue: string;
  propertyParcelValue: string;
  propertySubalternValue: string;
  activityCard: string;
  activityCreate: string;
  activityDialog: string;
  activityDescription: string;
  activityRelatedProperty: string;
  activityStatus: string;
  activitySave: string;
  activityCancel: string;
  propertyOwnersCard: string;
  propertyOwnerLinks: string;
}

/** Selectors verified on the authenticated Tecnocloud Lightning shell. */
export const crmSelectors: CrmSelectors = Object.assign(Object.fromEntries([
  "pageMarker", "sessionExpiredMarker", "unexpectedError", "personSearchPage", "personSearchTaxCode",
  "personSearchPhone", "personSearchSubmit", "personResultRows", "personResultId",
  "personResultLabel", "personResultOpen", "personCreate", "personFullName", "personBirthPlace",
  "personBirthProvince", "personBirthDate", "personTaxCode", "personMobile",
  "personOfficePhone", "personOtherPhone", "personEmail", "personSave", "recordId", "propertySearchPage",
  "propertyFiltersOpen", "propertySearchSheet", "propertySearchParcel", "propertySearchSubaltern",
  "propertySearchSubmit", "propertyResultRow", "propertyResultId", "propertyResultOpen", "propertyCreate",
  "propertyAddress", "propertyCategory", "propertyClass", "propertyConsistency",
  "propertyIncome", "propertySave", "ownerPersonId", "ownerShare", "ownerSave",
  "personResultsReady", "personRelatedTab", "personPropertiesCard", "personPropertyLinks",
  "propertySheetValue", "propertyParcelValue", "propertySubalternValue", "activityCard",
  "activityCreate", "activityDialog", "activityDescription", "activityRelatedProperty",
  "activityStatus", "activitySave", "activityCancel", "propertyOwnersCard", "propertyOwnerLinks",
].map((key) => [key, ""])) as unknown as CrmSelectors, {
  pageMarker: 'a[href*="/CRMImmobiliareLightning/s/account/Account"], a[href*="/CRMImmobiliareLightning/s/immobile/Immobile__c"]',
  sessionExpiredMarker: 'input[type="password"]',
  personSearchPage: 'a[href*="/CRMImmobiliareLightning/s/account/Account"]',
  personSearchTaxCode: 'input[title="Search..."]',
  personSearchPhone: 'input[title="Search..."]',
  personSearchSubmit: 'input[title="Search..."]',
  personResultRows: 'tr:has(a[data-refid="recordId"][data-recordid][href*="/s/account/"])',
  personResultId: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultLabel: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultOpen: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultsReady: 'h1:has-text("Risultati di ricerca")',
  personRelatedTab: '[role="tab"]:has-text("Correlati")',
  personPropertiesCard: 'article:visible:has-text("Immobili/Notizie/Incarichi")',
  personPropertyLinks: 'a[href*="/s/immobile/"]',
  propertySheetValue: '.flex:has(> div > label:has-text("Catasto Foglio")) .slds-form-element__static .slds-grow',
  propertyParcelValue: '.flex:has(> div > label:has-text("Catasto Particella")) .slds-form-element__static .slds-grow',
  propertySubalternValue: '.flex:has(> div > label:has-text("Catasto Subalterno")) .slds-form-element__static .slds-grow',
  activityCard: 'article:visible:has-text("Attivit")',
  activityCreate: 'button:has-text("Nuovo")',
  activityDialog: '[role="dialog"]:visible',
  activityDescription: 'textarea',
  activityRelatedProperty: '.slds-form-element_horizontal:has-text("Correlato a") input',
  activityStatus: '.slds-form-element_horizontal:has-text("Stato") input',
  activitySave: 'button:has-text("Salva")',
  activityCancel: 'button:has-text("Annulla")',
  propertyOwnersCard: 'article:visible:has-text("Soggetti collegati (")',
  propertyOwnerLinks: 'a[href*="/s/account/"]',
  propertySearchPage: 'a[href*="/CRMImmobiliareLightning/s/immobile/Immobile__c"]',
  propertyFiltersOpen: 'button[title="Filters"]',
  propertySearchSheet: 'lightning-input[c-queryviewerfilters_queryviewerfilters][data-index="22"] input',
  propertySearchParcel: 'lightning-input[c-queryviewerfilters_queryviewerfilters][data-index="23"] input',
  propertySearchSubaltern: 'lightning-input[c-queryviewerfilters_queryviewerfilters][data-index="27"] input',
  propertySearchSubmit: 'button:visible:has-text("Applica")',
  propertyResultRow: 'tr:has(lightning-input[c-queryviewer_queryviewer][data-id])',
  propertyResultId: 'lightning-input[c-queryviewer_queryviewer][data-id]',
  propertyResultOpen: 'a[data-id], a[data-recordid]',
  ownerPersonId: '.slds-form-element_horizontal:has-text("Cliente") input',
  ownerShare: '.slds-form-element_horizontal:has-text("Quota") input',
  ownerSave: '[role="dialog"] button:has-text("Salva")',
});

export const crmFixtureSelectors: CrmSelectors = Object.fromEntries([
  "pageMarker", "sessionExpiredMarker", "unexpectedError", "personSearchPage", "personSearchTaxCode",
  "personSearchPhone", "personSearchSubmit", "personResultRows", "personResultId",
  "personResultLabel", "personResultOpen", "personCreate", "personFullName", "personBirthPlace",
  "personBirthProvince", "personBirthDate", "personTaxCode", "personMobile",
  "personOfficePhone", "personOtherPhone", "personEmail", "personSave", "recordId", "propertySearchPage",
  "propertyFiltersOpen", "propertySearchSheet", "propertySearchParcel", "propertySearchSubaltern",
  "propertySearchSubmit", "propertyResultRow", "propertyResultId", "propertyResultOpen", "propertyCreate",
  "propertyAddress", "propertyCategory", "propertyClass", "propertyConsistency",
  "propertyIncome", "propertySave", "ownerPersonId", "ownerShare", "ownerSave",
  "personResultsReady", "personRelatedTab", "personPropertiesCard", "personPropertyLinks",
  "propertySheetValue", "propertyParcelValue", "propertySubalternValue", "activityCard",
  "activityCreate", "activityDialog", "activityDescription", "activityRelatedProperty",
  "activityStatus", "activitySave", "activityCancel", "propertyOwnersCard", "propertyOwnerLinks",
].map((key) => [key, `[data-worker-crm="${key}"]`])) as unknown as CrmSelectors;
