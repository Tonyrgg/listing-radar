export interface CrmSelectors {
  pageMarker: string;
  sessionExpiredMarker: string;
  unexpectedError: string;
  blockingDialog: string;
  loadingSpinner: string;
  personSearchPage: string;
  personSearchTaxCode: string;
  personSearchPhone: string;
  personSearchSubmit: string;
  personResultRows: string;
  personResultId: string;
  personResultLabel: string;
  personResultOpen: string;
  personCreate: string;
  personCreateMenuItem: string;
  personFullName: string;
  personFirstName: string;
  personLastName: string;
  personGender: string;
  personGenderOption: string;
  personBirthPlace: string;
  personBirthPlaceOption: string;
  personBirthProvince: string;
  personBirthDate: string;
  personTaxCode: string;
  personMobile: string;
  personOfficePhone: string;
  personOtherPhone: string;
  personEmail: string;
  personSave: string;
  recordId: string;
  personMergeDialog: string;
  personMergeReady: string;
  personMergeBlocked: string;
  personMergeConfirm: string;
  personMergeMessage: string;
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
  propertyCreateMenuItem: string;
  propertyType: string;
  propertySubtype: string;
  propertyFloor: string;
  propertyFloorNumber: string;
  propertyCivic: string;
  propertyInternal: string;
  propertyStaircase: string;
  propertyMunicipality: string;
  propertyMunicipalityOption: string;
  propertyPostalCode: string;
  propertyNext: string;
  propertyGoogleSameValue: string;
  propertyGoogleCurrentRadio: string;
  propertyGoogleSuggestedRadio: string;
  propertyLocality: string;
  propertyLocalityOption: string;
  propertyCommercialSquareMeters: string;
  propertyAddress: string;
  propertySheet: string;
  propertyParcel: string;
  propertySubaltern: string;
  propertyCategory: string;
  propertyClass: string;
  propertyConsistency: string;
  propertyIncome: string;
  propertySave: string;
  ownerCreate: string;
  ownerDialog: string;
  ownerPersonId: string;
  ownerPersonOption: string;
  ownerRight: string;
  ownerRole: string;
  ownerRoleOption: string;
  ownerShare: string;
  ownerSave: string;
  ownerCancel: string;
  ownerAlreadyLinkedError: string;
  personResultsReady: string;
  personRelatedTab: string;
  personPropertiesCard: string;
  personPropertyLinks: string;
  personPropertiesViewAll: string;
  propertySheetValue: string;
  propertyParcelValue: string;
  propertySubalternValue: string;
  propertyAddressValue: string;
  activityCard: string;
  activityCreate: string;
  activityDialog: string;
  activityDescription: string;
  activityClient: string;
  activityRelatedProperty: string;
  activityStatus: string;
  activityOption: string;
  activitySave: string;
  activityCancel: string;
  propertyOwnersCard: string;
  propertyOwnerLinks: string;
}

/** Selectors verified on the authenticated Tecnocloud Lightning shell. */
export const crmSelectors: CrmSelectors = Object.assign(Object.fromEntries([
  "pageMarker", "sessionExpiredMarker", "unexpectedError", "blockingDialog", "loadingSpinner", "personSearchPage", "personSearchTaxCode",
  "personSearchPhone", "personSearchSubmit", "personResultRows", "personResultId",
  "personResultLabel", "personResultOpen", "personCreate", "personCreateMenuItem", "personFullName", "personFirstName", "personLastName", "personGender", "personGenderOption", "personBirthPlace", "personBirthPlaceOption",
  "personBirthProvince", "personBirthDate", "personTaxCode", "personMobile",
  "personOfficePhone", "personOtherPhone", "personEmail", "personSave", "recordId", "personMergeDialog",
  "personMergeReady", "personMergeBlocked", "personMergeConfirm", "personMergeMessage", "propertySearchPage",
  "propertyFiltersOpen", "propertySearchSheet", "propertySearchParcel", "propertySearchSubaltern",
  "propertySearchSubmit", "propertyResultRow", "propertyResultId", "propertyResultOpen", "propertyCreate", "propertyCreateMenuItem",
  "propertyType", "propertySubtype", "propertyFloor", "propertyFloorNumber", "propertyCivic", "propertyInternal", "propertyStaircase",
  "propertyMunicipality", "propertyMunicipalityOption", "propertyPostalCode", "propertyNext", "propertyGoogleSameValue", "propertyGoogleCurrentRadio", "propertyGoogleSuggestedRadio",
  "propertyLocality", "propertyLocalityOption", "propertyCommercialSquareMeters",
  "propertyAddress", "propertySheet", "propertyParcel", "propertySubaltern", "propertyCategory", "propertyClass", "propertyConsistency",
  "propertyIncome", "propertySave", "ownerCreate", "ownerDialog", "ownerPersonId", "ownerPersonOption", "ownerRight", "ownerRole", "ownerRoleOption", "ownerShare", "ownerSave", "ownerCancel", "ownerAlreadyLinkedError",
  "personResultsReady", "personRelatedTab", "personPropertiesCard", "personPropertyLinks", "personPropertiesViewAll",
  "propertySheetValue", "propertyParcelValue", "propertySubalternValue", "propertyAddressValue", "activityCard",
  "activityCreate", "activityDialog", "activityDescription", "activityClient", "activityRelatedProperty",
  "activityStatus", "activityOption", "activitySave", "activityCancel", "propertyOwnersCard", "propertyOwnerLinks",
].map((key) => [key, ""])) as unknown as CrmSelectors, {
  pageMarker: 'a[href*="/CRMImmobiliareLightning/s/account/Account"], a[href*="/CRMImmobiliareLightning/s/immobile/Immobile__c"]',
  sessionExpiredMarker: 'input[type="password"]',
  blockingDialog: '[role="dialog"]',
  loadingSpinner: 'lightning-spinner',
  personSearchPage: 'a[href*="/CRMImmobiliareLightning/s/account/Account"]',
  personSearchTaxCode: 'input[title="Search..."]',
  personSearchPhone: 'input[title="Search..."]',
  personSearchSubmit: 'input[title="Search..."]',
  personResultRows: 'tr:has(a[data-refid="recordId"][data-recordid][href*="/s/account/"])',
  personResultId: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultLabel: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultOpen: 'a[data-refid="recordId"][data-recordid][href*="/s/account/"]',
  personResultsReady: 'h1:has-text("Risultati di ricerca")',
  personCreate: 'c-spotlight .icon_container',
  personCreateMenuItem: 'c-spotlight li.element:has-text("Nominativo")',
  personFirstName: '.slds-form-element:has(label:text-is("Nome")) input',
  personLastName: '.slds-form-element:has(label:has-text("Cognome")) input',
  personGender: 'c-picklist:has(label:text-is("Sesso")) input[role="textbox"]',
  personGenderOption: 'c-picklist:has(label:text-is("Sesso")) [role="option"]',
  personBirthPlace: 'c-lookup:has(label:text-is("Luogo Di Nascita")) input[placeholder="Cerca"]',
  personBirthPlaceOption: 'c-lookup:has(label:text-is("Luogo Di Nascita")) [role="option"].slds-listbox__option_has-meta',
  personBirthDate: 'c-input-date-time:has(label:text-is("Data Di Nascita")) c-date-picker input',
  personTaxCode: '.slds-form-element:has-text("Codice Fiscale") input',
  personMobile: '.slds-form-element:has-text("Cellulare") input',
  personOfficePhone: '.slds-form-element:has-text("Telefono fisso") input',
  personEmail: '.slds-form-element:has-text("Email") input',
  personSave: 'button:visible:has-text("Salva")',
  personRelatedTab: '[role="tab"]:has-text("Correlati")',
  personPropertiesCard: 'article:visible:has-text("Immobili/Notizie/Incarichi")',
  personPropertyLinks: 'a[href*="/s/immobile/"]',
  personPropertiesViewAll: 'a:has-text("Visualizza tutto"), button:has-text("Visualizza tutto")',
  propertySheetValue: '.flex:has(> div > label:has-text("Catasto Foglio")) .slds-form-element__static .slds-grow',
  propertyParcelValue: '.flex:has(> div > label:has-text("Catasto Particella")) .slds-form-element__static .slds-grow',
  propertySubalternValue: '.flex:has(> div > label:has-text("Catasto Subalterno")) .slds-form-element__static .slds-grow',
  propertyAddressValue: 'li.slds-page-header__detail-block:has(.slds-text-title:has-text("Indirizzo Completo Immobile")) c-output-field',
  activityCard: 'article:visible:has-text("Attivit"):has(button:has-text("Nuovo"))',
  activityCreate: 'button:has-text("Nuovo")',
  // The custom c-lwc-modal host has a zero-sized box in production. Target the
  // rendered dialog and keep form controls global + visible in the adapter.
  activityDialog: '[role="dialog"]:visible',
  activityDescription: 'c-input-field:has-text("Descrizione") textarea',
  activityClient: 'c-input-field:has-text("Cliente") input',
  activityRelatedProperty: 'c-input-field:has-text("Correlato a")',
  activityStatus: 'c-input-field:has-text("Stato") input',
  activityOption: '[role="option"]',
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
  propertyCreate: 'c-menu button',
  propertyCreateMenuItem: 'c-menu a[role="menuitem"]:has(span[title="Nuovo"])',
  propertyType: 'c-picklist:has(label:has-text("Tipologia Immobile"))',
  propertySubtype: 'c-picklist:has(label:has-text("Sottotipologia Immobile"))',
  propertyFloor: 'c-picklist:has(label:has-text("Piano Immobile"))',
  propertyFloorNumber: 'lightning-input:has(label:text-is("Numero Piano")) input',
  propertyAddress: 'lightning-input:has(label:text-is("Indirizzo")) input',
  propertyCivic: 'lightning-input:has(label:text-is("Civico")) input',
  propertyInternal: 'lightning-input:has(label:text-is("Interno")) input',
  propertyStaircase: 'lightning-input:has(label:text-is("Lettera")) input',
  propertyMunicipality: 'c-lookup:has(label:has-text("Comune"))',
  propertyMunicipalityOption: '[role="option"].slds-listbox__option_has-meta',
  propertyPostalCode: 'c-picklist:has(label:has-text("CAP")) input[role="textbox"]',
  propertyNext: 'button:visible:has-text("Avanti")',
  propertyGoogleSameValue: 'text="Stesso valore"',
  propertyGoogleCurrentRadio: 'input[type="radio"][id*="_current-"]',
  propertyGoogleSuggestedRadio: 'input[type="radio"]:not([id*="_current-"])',
  propertyLocality: 'c-picklist:has(label:has-text("LOCALIT")), c-picklist:has(label:has-text("Localit")), lightning-combobox:has(label:has-text("LOCALIT")), lightning-combobox:has(label:has-text("Localit"))',
  propertyLocalityOption: '[role="option"]',
  propertyCommercialSquareMeters: 'lightning-input:has(label:has-text("Metri Quadri Commerciali")) input',
  propertySave: 'button:visible:has-text("Salva")',
  ownerCreate: 'button:has-text("Nuovo")',
  ownerDialog: '[role="dialog"]:visible:has-text("Soggetto correlato")',
  ownerPersonId: 'c-lookup:has(label:text-is("Cliente")) input[placeholder="Cerca"]',
  ownerPersonOption: 'c-lookup:has(label:text-is("Cliente")) [role="option"]:has([data-item-id])',
  ownerRight: 'lightning-input:has(label:text-is("Diritto")) input',
  ownerRole: 'c-picklist:has(label:text-is("Ruolo"))',
  ownerRoleOption: 'c-picklist:has(label:text-is("Ruolo")) [role="option"]',
  ownerShare: 'lightning-input:has(label:text-is("Quota")) input',
  ownerSave: 'button:has-text("Salva")',
  ownerCancel: 'button:has-text("Annulla")',
  ownerAlreadyLinkedError: '[role="dialog"]:has-text("proprietario pricipale")',
});

export const crmFixtureSelectors: CrmSelectors = Object.fromEntries([
  "pageMarker", "sessionExpiredMarker", "unexpectedError", "blockingDialog", "loadingSpinner", "personSearchPage", "personSearchTaxCode",
  "personSearchPhone", "personSearchSubmit", "personResultRows", "personResultId",
  "personResultLabel", "personResultOpen", "personCreate", "personCreateMenuItem", "personFullName", "personFirstName", "personLastName", "personGender", "personGenderOption", "personBirthPlace", "personBirthPlaceOption",
  "personBirthProvince", "personBirthDate", "personTaxCode", "personMobile",
  "personOfficePhone", "personOtherPhone", "personEmail", "personSave", "recordId", "personMergeDialog",
  "personMergeReady", "personMergeBlocked", "personMergeConfirm", "personMergeMessage", "propertySearchPage",
  "propertyFiltersOpen", "propertySearchSheet", "propertySearchParcel", "propertySearchSubaltern",
  "propertySearchSubmit", "propertyResultRow", "propertyResultId", "propertyResultOpen", "propertyCreate", "propertyCreateMenuItem",
  "propertyType", "propertySubtype", "propertyFloor", "propertyFloorNumber", "propertyCivic", "propertyInternal", "propertyStaircase",
  "propertyMunicipality", "propertyMunicipalityOption", "propertyPostalCode", "propertyNext", "propertyGoogleSameValue", "propertyGoogleCurrentRadio", "propertyGoogleSuggestedRadio",
  "propertyLocality", "propertyLocalityOption", "propertyCommercialSquareMeters",
  "propertyAddress", "propertySheet", "propertyParcel", "propertySubaltern", "propertyCategory", "propertyClass", "propertyConsistency",
  "propertyIncome", "propertySave", "ownerCreate", "ownerDialog", "ownerPersonId", "ownerPersonOption", "ownerRight", "ownerRole", "ownerRoleOption", "ownerShare", "ownerSave", "ownerCancel", "ownerAlreadyLinkedError",
  "personResultsReady", "personRelatedTab", "personPropertiesCard", "personPropertyLinks", "personPropertiesViewAll",
  "propertySheetValue", "propertyParcelValue", "propertySubalternValue", "propertyAddressValue", "activityCard",
  "activityCreate", "activityDialog", "activityDescription", "activityClient", "activityRelatedProperty",
  "activityStatus", "activityOption", "activitySave", "activityCancel", "propertyOwnersCard", "propertyOwnerLinks",
].map((key) => [key, `[data-worker-crm="${key}"]`])) as unknown as CrmSelectors;
