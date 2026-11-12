import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright";
import { TecnocloudUiV2Port, ownershipSyncConfirmed } from "../src/import-v2/tecnocloud-ui-port.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import type { OwnershipWrite } from "../src/import-v2/ports.js";
import type { CrmOwnershipSnapshot } from "../src/import-v2/model.js";

const desired: OwnershipWrite = { personId: "owner-2", taxCode: "TESTCF0000000002", fullName: "Secondo Test", role: "Comproprietario", sharePercentage: 50 };
const saved: CrmOwnershipSnapshot = { ...desired, linkId: "link-2", rightType: "Proprietà" };
function fixture() {
  const page = { goto: vi.fn().mockResolvedValue(undefined), url: () => "https://tecnocasa-group.my.site.com/CRMImmobiliareLightning/s/", waitForTimeout: vi.fn().mockResolvedValue(undefined) };
  const port = new TecnocloudUiV2Port(page as unknown as Page);
  const internal = port as unknown as {
    readOwnerships: () => Promise<CrmOwnershipSnapshot[]>;
    syncPrimaryOwnership: () => Promise<boolean>;
    addOwnership: () => Promise<void>; updateOwnership: () => Promise<void>;
    syncLinkedOwnership: (id: string, owner: OwnershipWrite, existing?: CrmOwnershipSnapshot) => Promise<CrmOwnershipSnapshot[]>;
  };
  const read = vi.spyOn(internal, "readOwnerships");
  const add = vi.spyOn(internal, "addOwnership").mockResolvedValue();
  const update = vi.spyOn(internal, "updateOwnership").mockResolvedValue();
  return { port, internal, page, read, add, update };
}
describe("Conferma singolo soggetto correlato", () => {
  it("recupera una risposta persa dopo il salvataggio senza reinviarlo", async () => {
    const f = fixture(); f.add.mockRejectedValue(new Error("Risposta persa"));
    f.read.mockResolvedValueOnce([]).mockResolvedValue([saved]);
    expect(await f.internal.syncLinkedOwnership("property", desired)).toEqual([saved]);
    expect(f.add).toHaveBeenCalledTimes(1); expect(f.page.goto).toHaveBeenCalledTimes(2);
  });
  it("attende ruolo e quota pubblicati in ritardo senza creare due collegamenti", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce([{ ...saved, sharePercentage: null }]).mockResolvedValue([saved]);
    await f.internal.syncLinkedOwnership("property", desired);
    expect(f.add).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(2);
  });
  it("non conferma un salvataggio assente e limita le riletture", async () => {
    const f = fixture(); f.read.mockResolvedValue([]);
    await expect(f.internal.syncLinkedOwnership("property", desired)).rejects.toThrow(/non confermato/);
    expect(f.add).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(3);
  });
  it("aggiorna un collegamento esistente una sola volta e verifica la quota", async () => {
    const f = fixture(); f.read.mockResolvedValue([saved]);
    await f.internal.syncLinkedOwnership("property", desired, { ...saved, sharePercentage: 25 });
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.add).not.toHaveBeenCalled();
  });
  it("non recupera una sessione scaduta come se fosse un salvataggio riuscito", async () => {
    const f = fixture(); f.add.mockRejectedValue(new ImportV2Error("Sessione scaduta", "global_session", { global: true }));
    await expect(f.internal.syncLinkedOwnership("property", desired)).rejects.toThrow(/Sessione scaduta/);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("preserva i non inclusi solo quando richiesto, ma non accetta duplicati", () => {
    const other = { ...saved, personId: "other", linkId: "other-link" };
    expect(ownershipSyncConfirmed([saved, other], [desired])).toBe(false);
    expect(ownershipSyncConfirmed([saved, other], [desired], true)).toBe(true);
    expect(ownershipSyncConfirmed([saved, { ...saved, linkId: "duplicate" }], [desired], true)).toBe(false);
  });
  it("rifiuta intestatari duplicati prima di qualsiasi lettura o scrittura", async () => {
    const f = fixture(); vi.spyOn(f.port, "assertSession").mockResolvedValue();
    await expect(f.port.replaceManagedOwnerships("property", [desired, desired])).rejects.toThrow(/duplicati/);
    expect(f.read).not.toHaveBeenCalled(); expect(f.add).not.toHaveBeenCalled();
  });
  it("non passa al secondo comproprietario quando il primo non è confermato", async () => {
    const f = fixture(); vi.spyOn(f.port, "assertSession").mockResolvedValue();
    vi.spyOn(f.internal, "syncPrimaryOwnership").mockResolvedValue(false);
    const primary = { ...saved, personId: "primary", taxCode: "RSSMRA80A01A893P", role: "Proprietario Principale" };
    f.read.mockResolvedValue([primary]);
    await expect(f.port.replaceManagedOwnerships("property", [
      { ...primary, role: "Proprietario Principale", fullName: "Primo Test" },
      desired, { ...desired, personId: "third" },
    ])).rejects.toThrow(/non confermato/);
    expect(f.add).toHaveBeenCalledTimes(1);
  });
  it("alla ripresa rilegge i collegamenti e non aggiunge di nuovo il comproprietario già salvato", async () => {
    const f = fixture(); vi.spyOn(f.port, "assertSession").mockResolvedValue();
    vi.spyOn(f.internal, "syncPrimaryOwnership").mockResolvedValue(false);
    const primary = { ...saved, personId: "primary", taxCode: "RSSMRA80A01A893P", role: "Proprietario Principale" };
    f.read.mockResolvedValue([primary, saved]);
    await f.port.replaceManagedOwnerships("property", [{ ...primary, role: "Proprietario Principale", fullName: "Primo Test" }, desired]);
    expect(f.add).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
  });
});
