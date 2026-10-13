import { describe, it, expect, vi } from 'vitest';
import { chromium, type Locator } from 'playwright';
import { TecnocloudUiV2Port } from '../src/import-v2/tecnocloud-ui-port.js';
import { ImportV2Error } from '../src/import-v2/errors.js';
import { additionalPhonesFromNotes, personWriteModel } from '../src/import-v2/contacts.js';
import { canonicalBirthPlace } from '../src/import-v2/identity.js';
import { simulationSource } from '../src/territory/providers.js';
import type { CrmOwnershipSnapshot, CrmPersonSnapshot } from '../src/import-v2/model.js';
import type { PersonWriteModel } from '../src/import-v2/contacts.js';
const street = { id: 'fixture', name: 'Via Prova', sisterName: 'VIA PROVA', locality: 'Bitonto', needsReview: false, geometry: null, geometryEvidence: null };
const desired = personWriteModel({ ...simulationSource(street, 1, 'fixture').owners[0]!, birthPlace: null, birthDate: null, contacts: { phones: ['3331111111','3492222222','0801111111'], emails: [] } }, null);
const detail = (label: string, value: string) => `<div><div><label>${label}</label></div><span class="slds-form-element__static">${value}</span></div>`;
describe('Recupero casi reali V2, senza perdita di recapiti o identità', () => {
  it('un valore mancante senza output non prende mai quello di un altro campo', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.setContent(`<section>${detail('Codice Fiscale',desired.taxCode)}<div><label>Luogo Di Nascita</label></div>${detail('Nome','Nome')}</section>`);
      const port = new TecnocloudUiV2Port(page), internal = port as unknown as { detailValue(label: string): Promise<string> };
      expect(await internal.detailValue('Luogo Di Nascita')).toBe('');
      expect(await internal.detailValue('Codice Fiscale')).toBe(desired.taxCode);
      expect(await internal.detailValue('Nome')).toBe('Nome');
    } finally { await browser.close(); }
  });
  it('trova il comando filtri anche con etichette italiane e non prende un controllo nascosto', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.setContent('<button title="Filters" hidden>Filtri</button><button title="Filtri">Apri</button>');
      const port = new TecnocloudUiV2Port(page), internal = port as unknown as { filterButton(): Locator };
      expect(await internal.filterButton().count()).toBe(1); expect(await internal.filterButton().innerText()).toBe('Apri');
      await page.setContent('<button aria-label="Filtri"></button>'); expect(await internal.filterButton().count()).toBe(1);
    } finally { await browser.close(); }
  });
  it('usa i campi disponibili e conserva gli altri recapiti nelle note, rileggendoli dopo il salvataggio', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<div class="slds-form-element"><label for="name">Nome</label><input id="name"></div><div class="slds-form-element"><label for="surname">Cognome</label><input id="surname"></div><label for="cf">Codice Fiscale</label><input id="cf"><label for="mobile">Cellulare</label><input id="mobile"><label for="fixed">Telefono fisso</label><input id="fixed"><label for="notes">Note Private</label><textarea id="notes">Nota dell'operatore\nSeconda riga</textarea>`);
      const port = new TecnocloudUiV2Port(page), internal = port as unknown as { fillPersonFields(d: PersonWriteModel, edit: boolean): Promise<boolean>; readCurrentPerson(id: string, cf: string): Promise<CrmPersonSnapshot>; openPerson(id: string): Promise<void>; reactivateCurrentPersonIfArchived(): Promise<boolean> };
      expect(await internal.fillPersonFields(desired, true)).toBe(false);
      const notes = await page.locator('#notes').inputValue(), mobile = await page.locator('#mobile').inputValue(), fixed = await page.locator('#fixed').inputValue();
      expect(mobile).toBe('3331111111'); expect(fixed).toBe('0801111111');
      expect(notes).toContain("Nota dell'operatore\nSeconda riga"); expect(additionalPhonesFromNotes(notes)).toEqual(['3492222222']);
      await page.setContent(detail('Codice Fiscale',desired.taxCode)+detail('Nome',desired.firstName)+detail('Cognome',desired.lastName)+detail('Cellulare',mobile)+detail('Telefono fisso',fixed)+detail('Note Private',notes));
      vi.spyOn(internal, 'openPerson').mockResolvedValue(); vi.spyOn(internal, 'reactivateCurrentPersonIfArchived').mockResolvedValue(false);
      const saved = await internal.readCurrentPerson('fixture-person', desired.taxCode);
      expect(saved.phones).toEqual(expect.arrayContaining(desired.phones)); expect(saved.privateNotes).toBe(notes);
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
  it('riconosce il principale dopo una fusione per CF verificato, senza scegliere un’altra persona', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.route('https://tecnocasa-group.my.site.com/**', r => r.fulfill({ body: '<body></body>' })); await page.goto('https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/');
      const port = new TecnocloudUiV2Port(page);
      const old: CrmOwnershipSnapshot = { personId: 'old', taxCode: desired.taxCode, sharePercentage: 100, role: 'Proprietario Principale', rightType: 'Proprietà', linkId: 'p' };
      const internal = port as unknown as { readOwnerships(): Promise<CrmOwnershipSnapshot[]>; syncPrimaryOwnership(...args: unknown[]): Promise<boolean>; addOwnership(...args: unknown[]): Promise<void>; deleteOwnership(...args: unknown[]): Promise<void> };
      vi.spyOn(internal, 'readOwnerships').mockResolvedValueOnce([old]).mockResolvedValue([{ ...old, personId: 'canonical' }]);
      const sync = vi.spyOn(internal,'syncPrimaryOwnership').mockResolvedValue(true), add = vi.spyOn(internal,'addOwnership').mockResolvedValue(), remove = vi.spyOn(internal,'deleteOwnership').mockResolvedValue();
      await port.replaceManagedOwnerships('property', [{ personId: 'canonical', taxCode: desired.taxCode, fullName: desired.fullName, phones: [], sharePercentage: 100, role: 'Proprietario Principale' }]);
      expect(sync.mock.calls[0]?.[1]).toMatchObject({ personId: 'canonical' }); expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
  it('sostituisce un principale fuori da SISTER soltanto con la politica esplicita e conserva il precedente', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.route('https://tecnocasa-group.my.site.com/**', r => r.fulfill({ body: '<body></body>' })); await page.goto('https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/');
      const port = new TecnocloudUiV2Port(page);
      const before: CrmOwnershipSnapshot = { personId: 'old', taxCode: 'BNCNNA80B42A893X', sharePercentage: 100, role: 'Proprietario Principale', rightType: 'Proprietà', linkId: 'p' };
      const after: CrmOwnershipSnapshot[] = [{ ...before, personId: 'source-main', taxCode: desired.taxCode, sharePercentage: 70 }, { ...before, personId: 'source-other', taxCode: 'VRDLCU82B02A893X', sharePercentage: 30, role: 'Comproprietario' }];
      const internal = port as unknown as { readOwnerships(): Promise<CrmOwnershipSnapshot[]>; syncPrimaryOwnership(...args: unknown[]): Promise<boolean>; addOwnership(...args: unknown[]): Promise<void>; deleteOwnership(...args: unknown[]): Promise<void> };
      const reads = vi.spyOn(internal, 'readOwnerships').mockResolvedValue([before]);
      const sync = vi.spyOn(internal,'syncPrimaryOwnership').mockResolvedValue(true), add = vi.spyOn(internal,'addOwnership').mockResolvedValue(), remove = vi.spyOn(internal,'deleteOwnership').mockResolvedValue();
      const writes = after.map(o => ({ ...o, taxCode: o.taxCode!, fullName: o.personId, phones: [], role: o.role as 'Proprietario Principale' | 'Comproprietario' }));
      await expect(port.replaceManagedOwnerships('property', writes)).rejects.toThrow('senza cambiare proprietario'); expect(sync).not.toHaveBeenCalled();
      await expect(port.replaceManagedOwnerships('property', writes, { replaceUnlistedPrimary: true, sourceOwnerTaxCodes: [before.taxCode!, desired.taxCode] })).rejects.toThrow('senza cambiare proprietario'); expect(sync).not.toHaveBeenCalled();
      reads.mockResolvedValueOnce([before]).mockResolvedValue(after);
      const result = await port.replaceManagedOwnerships('property',writes,{ replaceUnlistedPrimary: true });
      expect(sync.mock.calls[0]?.[1]).toMatchObject({ personId: 'source-main', sharePercentage: 70 });
      expect(result.ownershipReplacement).toEqual({ before, afterPersonId: 'source-main' }); expect(result.owners).toEqual(after); expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
  it.each(['La ricerca CF mostra una schermata ambigua senza risultati verificabili', 'Filtri immobili non disponibile entro 12000 ms'])('ricarica la lettura bloccata: %s', async message => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.route('https://tecnocasa-group.my.site.com/**', r => r.fulfill({ body: '<body></body>' })); await page.goto('https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/');
      const reload = vi.spyOn(page, 'reload');
      const port = new TecnocloudUiV2Port(page, false, { recoverReadLoading: true });
      const internal = port as unknown as { readAction<T>(label: string, operation: () => Promise<T>): Promise<T> };
      const operation = vi.fn().mockRejectedValueOnce(new ImportV2Error(message, 'transient_portal', { retryable: true })).mockResolvedValue('confermato');
      expect(await internal.readAction('fixture', operation)).toBe('confermato'); expect(reload).toHaveBeenCalledOnce();
      await page.setContent('<section role="dialog">Scrittura in sospeso</section>'); reload.mockClear();
      await expect(internal.readAction('fixture', async () => { throw new ImportV2Error(message, 'transient_portal', { retryable: true }); })).rejects.toThrow(message); expect(reload).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
  it('aspetta il luogo di nascita dopo il salvataggio e distingue le sole differenze di formattazione', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage(); await page.setContent(detail('Codice Fiscale',desired.taxCode)+detail('Nome',desired.firstName)+detail('Cognome',desired.lastName)+detail('Luogo Di Nascita','')+`<script>setTimeout(()=>document.querySelectorAll('.slds-form-element__static')[3].textContent='BITONTO (BA)',900)</script>`);
      const port = new TecnocloudUiV2Port(page), internal = port as unknown as { readCurrentPerson(id: string, cf: string, d: PersonWriteModel): Promise<CrmPersonSnapshot>; openPerson(id: string): Promise<void>; reactivateCurrentPersonIfArchived(): Promise<boolean> };
      vi.spyOn(internal,'openPerson').mockResolvedValue(); vi.spyOn(internal,'reactivateCurrentPersonIfArchived').mockResolvedValue(false);
      const saved = await internal.readCurrentPerson('person',desired.taxCode,{ ...desired, birthPlace: 'BITONTO', birthProvince: 'BA' });
      expect(saved.birthPlace).toBe('BITONTO'); expect(saved.birthProvince).toBe('BA');
      expect(canonicalBirthPlace("Cassano d’Adda (MI)")).toBe(canonicalBirthPlace("CASSANO D'ADDA"));
      expect(canonicalBirthPlace('BITONTO')).not.toBe(canonicalBirthPlace('BITETTO'));
    } finally { vi.restoreAllMocks(); await browser.close(); }
  });
});
