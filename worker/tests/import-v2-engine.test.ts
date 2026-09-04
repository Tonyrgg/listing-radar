import { describe, expect, it } from "vitest";

import { ImportV2Engine } from "../src/import-v2/engine.js";
import { ImportV2Error } from "../src/import-v2/errors.js";
import type {
  CrmPersonSnapshot,
  CrmPropertySnapshot,
  ImportV2Checkpoint,
  ImportV2Failure,
  ImportV2Plan,
  SourceProperty,
} from "../src/import-v2/model.js";
import type {
  CrmOwnershipSnapshotResult,
  ImportV2Store,
  MergeRequest,
  OwnershipSyncOptions,
  OwnershipWrite,
  TecnocloudV2Port,
} from "../src/import-v2/ports.js";
import { runImportV2Batch } from "../src/import-v2/queue.js";
import { isManagedCrmOwnership } from "../src/import-v2/ownership-policy.js";

const property = (id = "property-1"): SourceProperty => ({
  sourcePropertyId: id,
  jobId: "job-1",
  municipality: "BITONTO",
  fullAddress: `Arco Angarano ${id === "property-2" ? "11" : "10"}, 70032 BITONTO (BA)`,
  cadastral: {
    urbanSection: null,
    sheet: "49",
    parcel: id === "property-2" ? "1244" : "1243",
    parcelDenomination: null,
    subaltern: "34",
    income: 356.36,
  },
  category: "A/2",
  propertyClass: "3",
  consistency: "6 vani",
  activity: { enabled: true, description: "Contatto proprietari", contactMode: "Contatto diretto", status: "Da eseguire" },
  owners: [
    {
      sourcePersonId: `${id}-mario`, taxCode: "RSSMRA80A01A893P", fullName: "Rossi Mario",
      birthDate: "1980-01-01", birthPlace: "Bitonto", birthProvince: "BA", rightType: "Proprietà", sharePercentage: 50,
      contacts: { phones: ["3331111111"], emails: ["mario@example.it"] },
    },
    {
      sourcePersonId: `${id}-luca`, taxCode: "VRDLCU82B02A893X", fullName: "Verdi Luca",
      birthDate: "1982-02-02", birthPlace: "Bitonto", birthProvince: "BA", rightType: "Proprietà", sharePercentage: 50,
      contacts: { phones: ["3332222222"], emails: [] },
    },
  ],
});

class MemoryStore implements ImportV2Store {
  checkpoints = new Map<string, ImportV2Checkpoint>();
  quarantined: Array<{ sourcePropertyId: string; failure: ImportV2Failure }> = [];
  paused: ImportV2Failure[] = [];
  events: string[] = [];

  async loadOrCreate(plan: ImportV2Plan): Promise<ImportV2Checkpoint> {
    const current = this.checkpoints.get(plan.source.sourcePropertyId);
    if (current) return structuredClone(current);
    const checkpoint: ImportV2Checkpoint = {
      itemId: `item-${plan.source.sourcePropertyId}`,
      jobId: plan.source.jobId,
      propertyId: plan.source.sourcePropertyId,
      stage: "queued",
      plan,
      people: [],
      syncedPeople: [],
      propertyResolution: null,
      crmPropertyId: null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: new Date(0).toISOString(),
    };
    this.checkpoints.set(plan.source.sourcePropertyId, structuredClone(checkpoint));
    return checkpoint;
  }

  async save(checkpoint: ImportV2Checkpoint) {
    this.checkpoints.set(checkpoint.propertyId, structuredClone(checkpoint));
  }

  async recordEvent(_checkpoint: ImportV2Checkpoint, event: string) { this.events.push(event); }
  async quarantine(checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) {
    this.quarantined.push({ sourcePropertyId: checkpoint.propertyId, failure });
  }
  async pause(_checkpoint: ImportV2Checkpoint, failure: ImportV2Failure) { this.paused.push(failure); }
  async quarantineSource(source: SourceProperty, failure: ImportV2Failure) {
    this.quarantined.push({ sourcePropertyId: source.sourcePropertyId, failure });
  }
}

class FakeCrm implements TecnocloudV2Port {
  people = new Map<string, CrmPersonSnapshot>();
  properties = new Map<string, CrmPropertySnapshot>();
  searches: string[] = [];
  merges: MergeRequest[] = [];
  activities: string[] = [];
  recoveries = 0;
  replaceCalls = 0;
  lastOwnershipOptions: OwnershipSyncOptions = {};
  replaceFailures = 0;
  sessionFailure: ImportV2Error | null = null;
  nextPerson = 1;
  nextProperty = 1;

  async assertSession() {
    if (this.sessionFailure) throw this.sessionFailure;
  }

  async searchPeopleByExactTaxCode(taxCode: string) {
    this.searches.push(taxCode);
    return [...this.people.values()].filter((person) => person.taxCode === taxCode).map((person) => structuredClone(person));
  }

  async readPerson(personId: string, expectedTaxCode: string | null = null) {
    const person = this.people.get(personId);
    if (!person || (expectedTaxCode && person.taxCode !== expectedTaxCode)) throw new Error("missing person");
    return structuredClone(person);
  }

  async createPerson(desired: Omit<CrmPersonSnapshot, "id">) {
    const person = { id: `person-${this.nextPerson++}`, ...desired };
    this.people.set(person.id, structuredClone(person));
    return person;
  }

  async overwritePerson(personId: string, desired: Omit<CrmPersonSnapshot, "id">) {
    const person = { id: personId, ...desired };
    this.people.set(person.id, structuredClone(person));
    return person;
  }

  async mergePeople(request: MergeRequest) {
    this.merges.push(structuredClone(request));
    for (const id of request.duplicatePersonIds) this.people.delete(id);
    return this.overwritePerson(request.canonicalPersonId, request.desired);
  }

  async listAllPropertiesForPeople(personIds: string[], _plan: ImportV2Plan) {
    return [...this.properties.values()]
      .filter((candidate) => candidate.owners.some((owner) => personIds.includes(owner.personId)))
      .map(({ owners: _owners, ...summary }) => structuredClone(summary));
  }

  async findPropertiesByCadastralIdentity(plan: ImportV2Plan) {
    return [...this.properties.values()]
      .filter((candidate) => candidate.cadastral?.sheet === plan.source.cadastral.sheet
        && candidate.cadastral.parcel === plan.source.cadastral.parcel
        && candidate.cadastral.subaltern === plan.source.cadastral.subaltern)
      .map(({ owners: _owners, ...summary }) => structuredClone(summary));
  }

  async createProperty(plan: ImportV2Plan, _primaryPersonId: string) {
    const saved: CrmPropertySnapshot = {
      id: `crm-property-${this.nextProperty++}`,
      displayName: `IM - ${plan.source.fullAddress.split(",")[0]} - Test`,
      fullAddress: plan.source.fullAddress,
      cadastral: structuredClone(plan.source.cadastral),
      owners: [],
    };
    this.properties.set(saved.id, structuredClone(saved));
    return saved;
  }

  async updateProperty(propertyId: string, plan: ImportV2Plan) {
    const previous = this.properties.get(propertyId);
    if (!previous) throw new Error("missing property");
    const saved = { ...previous, fullAddress: plan.source.fullAddress, cadastral: structuredClone(plan.source.cadastral) };
    this.properties.set(propertyId, saved);
    return structuredClone(saved);
  }

  async replaceManagedOwnerships(propertyId: string, desired: OwnershipWrite[], options: OwnershipSyncOptions = {}): Promise<CrmOwnershipSnapshotResult> {
    this.replaceCalls += 1;
    this.lastOwnershipOptions = options;
    if (this.replaceFailures > 0) {
      this.replaceFailures -= 1;
      throw new ImportV2Error("dialog delayed", "transient_portal", { retryable: true });
    }
    const current = this.properties.get(propertyId);
    if (!current) throw new Error("missing property");
    const protectedOwners = current.owners.filter((owner) => !isManagedCrmOwnership(owner));
    const managedOwners = current.owners.filter(isManagedCrmOwnership);
    const unlisted = managedOwners.filter((owner) => !desired.some((item) => item.personId === owner.personId));
    const removedPersonIds = options.keepUnlistedManagedOwners ? [] : unlisted.map((owner) => owner.personId);
    current.owners = [
      ...protectedOwners,
      ...(options.keepUnlistedManagedOwners ? unlisted : []),
      ...desired.map((owner, index) => ({
        linkId: `link-${index}`,
        personId: owner.personId,
        taxCode: owner.taxCode,
        sharePercentage: owner.sharePercentage,
        rightType: "Proprietà",
        role: owner.role,
      })),
    ];
    return { propertyId, owners: structuredClone(current.owners), removedPersonIds };
  }

  async readProperty(propertyId: string) {
    const result = this.properties.get(propertyId);
    if (!result) throw new Error("missing property");
    return structuredClone(result);
  }

  async ensureActivity(propertyId: string, plan: ImportV2Plan) {
    if (!plan.source.activity.enabled) return { activityId: null, outcome: "disabled" as const };
    if (!this.activities.includes(propertyId)) this.activities.push(propertyId);
    return { activityId: `activity-${propertyId}`, outcome: "created" as const };
  }

  async recover() { this.recoveries += 1; }
}

describe("Import V2 engine", () => {
  it("non riscrive un nominativo già verificato se il comproprietario successivo richiede un retry", async () => {
    class RetrySecondCrm extends FakeCrm {
      writes: string[] = [];
      failSecond = true;
      override async createPerson(desired: Omit<CrmPersonSnapshot, "id">) {
        this.writes.push(desired.taxCode);
        if (desired.taxCode === "VRDLCU82B02A893X" && this.failSecond) {
          this.failSecond = false;
          throw new ImportV2Error("Risposta in ritardo", "transient_portal", { retryable: true });
        }
        return super.createPerson(desired);
      }
      override async overwritePerson(id: string, desired: Omit<CrmPersonSnapshot, "id">) {
        this.writes.push(desired.taxCode);
        return super.overwritePerson(id, desired);
      }
    }
    const crm = new RetrySecondCrm();
    expect((await new ImportV2Engine(crm, new MemoryStore()).run(property())).state).toBe("completed");
    expect(crm.writes.filter((taxCode) => taxCode === "RSSMRA80A01A893P")).toHaveLength(1);
    expect(crm.writes.filter((taxCode) => taxCode === "VRDLCU82B02A893X")).toHaveLength(2);
  });

  it("passa alla scrittura quando la ricerca catastale trova l'immobile esatto senza riaprire i nominativi", async () => {
    class ExactCrm extends FakeCrm {
      override async listAllPropertiesForPeople(): Promise<CrmPropertySnapshot[]> {
        throw new Error("Non deve ripercorrere gli immobili dei nominativi dopo il match catastale esatto");
      }
    }
    const crm = new ExactCrm();
    crm.properties.set("existing", {
      id: "existing", displayName: "IM - Arco Angarano 10 - Centro", fullAddress: property().fullAddress,
      cadastral: property().cadastral, owners: [],
    });
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run(property());
    expect(outcome).toMatchObject({ state: "completed", crmPropertyId: "existing" });
    expect(crm.properties).toHaveLength(1);
  });

  it.each(["rossi mario", "ROSSI MARIO", "mArIo RoSsI"])("verifica i nominativi senza distinzione di maiuscole: %s", async (fullName) => {
    class CaseCrm extends FakeCrm {
      override async createPerson(desired: Omit<CrmPersonSnapshot, "id">) {
        const saved = await super.createPerson(desired);
        if (saved.taxCode === "RSSMRA80A01A893P") saved.fullName = fullName;
        this.people.set(saved.id, structuredClone(saved));
        return saved;
      }
    }
    expect((await new ImportV2Engine(new CaseCrm(), new MemoryStore()).run(property())).state).toBe("completed");
  });

  it("accantona un immobile con azienda prima di qualunque accesso CRM", async () => {
    const crm = new FakeCrm();
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run({ ...property(), hasBusinessOwners: true });

    expect(outcome.state).toBe("quarantined");
    expect(outcome.failure?.kind).toBe("unsupported_case");
    expect(crm.searches).toHaveLength(0);
    expect(crm.people).toHaveLength(0);
    expect(crm.properties).toHaveLength(0);
  });

  it("cerca esclusivamente i codici fiscali, crea e verifica entrambi i comproprietari", async () => {
    const crm = new FakeCrm();
    const store = new MemoryStore();
    const outcome = await new ImportV2Engine(crm, store).run(property());

    expect(outcome.state).toBe("completed");
    expect(new Set(crm.searches)).toEqual(new Set(["RSSMRA80A01A893P", "VRDLCU82B02A893X"]));
    const savedProperty = [...crm.properties.values()][0]!;
    expect(savedProperty.owners).toHaveLength(2);
    expect(savedProperty.owners.map((owner) => owner.sharePercentage)).toEqual([50, 50]);
    expect(crm.activities).toEqual([savedProperty.id]);
  });

  it("non apre il dialog comproprietari finche ogni nominativo non e rileggibile per ID, CF e nome", async () => {
    class UnverifiedPersonCrm extends FakeCrm {
      override async readPerson(personId: string, expectedTaxCode: string | null = null) {
        const snapshot = await super.readPerson(personId, expectedTaxCode);
        if (snapshot.taxCode === "VRDLCU82B02A893X") snapshot.fullName = "Persona Diversa";
        return snapshot;
      }
    }
    const crm = new UnverifiedPersonCrm();
    const outcome = await new ImportV2Engine(crm, new MemoryStore(), { maxTransientAttempts: 1 }).run(property());

    expect(outcome.state).toBe("quarantined");
    expect(outcome.failure?.kind).toBe("verification_failed");
    expect(crm.replaceCalls).toBe(0);
    expect([...crm.properties.values()][0]?.owners).toEqual([]);
  });

  it("onora la pausa tra due nominativi senza avviare altri accessi CRM", async () => {
    let pauseRequested = false;
    class PauseAfterFirstSearchCrm extends FakeCrm {
      override async searchPeopleByExactTaxCode(taxCode: string) {
        const result = await super.searchPeopleByExactTaxCode(taxCode);
        pauseRequested = true;
        return result;
      }
    }
    const crm = new PauseAfterFirstSearchCrm();
    const store = new MemoryStore();
    const outcome = await new ImportV2Engine(crm, store, { isInterruptionRequested: () => pauseRequested }).run(property());

    expect(outcome.state).toBe("paused");
    expect(outcome.failure?.kind).toBe("operator_pause");
    expect(crm.searches).toEqual(["RSSMRA80A01A893P"]);
    expect(crm.people).toHaveLength(0);
    expect(crm.properties).toHaveLength(0);
    expect(store.paused).toHaveLength(1);
  });

  it("non sovrappone navigazioni sullo stesso tab Tecnocloud", async () => {
    class SerialCrm extends FakeCrm {
      active = 0;
      maximum = 0;
      private async guarded<T>(operation: () => Promise<T>): Promise<T> {
        this.active += 1;
        this.maximum = Math.max(this.maximum, this.active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return await operation();
        } finally {
          this.active -= 1;
        }
      }
      override searchPeopleByExactTaxCode(taxCode: string) {
        return this.guarded(() => super.searchPeopleByExactTaxCode(taxCode));
      }
      override listAllPropertiesForPeople(personIds: string[], plan: ImportV2Plan) {
        return this.guarded(() => super.listAllPropertiesForPeople(personIds, plan));
      }
      override findPropertiesByCadastralIdentity(plan: ImportV2Plan) {
        return this.guarded(() => super.findPropertiesByCadastralIdentity(plan));
      }
    }
    const crm = new SerialCrm();
    expect((await new ImportV2Engine(crm, new MemoryStore()).run(property())).state).toBe("completed");
    expect(crm.maximum).toBe(1);
  });

  it("fonde solo duplicati con CF identico scegliendo tutte le opzioni di sinistra", async () => {
    const crm = new FakeCrm();
    crm.people.set("dup-a", {
      id: "dup-a", taxCode: "RSSMRA80A01A893P", fullName: "Vecchio A", birthDate: null, birthPlace: null, birthProvince: null,
      phones: ["0801111111"], emails: ["a@example.it"],
    });
    crm.people.set("dup-b", {
      id: "dup-b", taxCode: "RSSMRA80A01A893P", fullName: "Vecchio B", birthDate: null, birthPlace: null, birthProvince: null,
      phones: ["3339999999"], emails: ["b@example.it"],
    });
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run(property());

    expect(outcome.state).toBe("completed");
    expect(crm.merges).toHaveLength(1);
    expect(crm.merges[0]).toMatchObject({ taxCode: "RSSMRA80A01A893P", fieldSelection: "all_left" });
    expect(crm.people.get("dup-a")?.phones).toEqual(expect.arrayContaining(["0801111111", "3339999999", "3331111111"]));
  });

  it("non ricrea il nominativo se l'indice globale è vuoto subito dopo un salvataggio verificato", async () => {
    class DelayedSearchIndexCrm extends FakeCrm {
      hiddenAfterSave = new Set<string>();

      override async createPerson(desired: Omit<CrmPersonSnapshot, "id">) {
        const saved = await super.createPerson(desired);
        this.hiddenAfterSave.add(saved.taxCode);
        return saved;
      }

      override async searchPeopleByExactTaxCode(taxCode: string) {
        if (this.hiddenAfterSave.delete(taxCode)) {
          this.searches.push(taxCode);
          return [];
        }
        return super.searchPeopleByExactTaxCode(taxCode);
      }
    }
    const crm = new DelayedSearchIndexCrm();
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run(property());

    expect(outcome.state).toBe("completed");
    expect(crm.nextPerson).toBe(3);
    expect(crm.people).toHaveLength(2);
  });

  it("verifica il nome cliente anche quando Tecnocloud mostra nome e cognome in ordine inverso", async () => {
    class DisplayOrderCrm extends FakeCrm {
      override async createPerson(desired: Omit<CrmPersonSnapshot, "id">) {
        const saved = await super.createPerson(desired);
        saved.fullName = saved.fullName.split(/\s+/).reverse().join(" ");
        this.people.set(saved.id, structuredClone(saved));
        return saved;
      }
    }
    const outcome = await new ImportV2Engine(new DisplayOrderCrm(), new MemoryStore()).run(property());
    expect(outcome.state).toBe("completed");
  });

  it("aggiorna il catasto dell'immobile quando coincide soltanto l'indirizzo", async () => {
    const crm = new FakeCrm();
    crm.people.set("existing-owner", {
      id: "existing-owner", taxCode: "RSSMRA80A01A893P", fullName: "Rossi Mario", birthDate: "1980-01-01",
      birthPlace: "Bitonto", birthProvince: "BA", phones: [], emails: [],
    });
    crm.properties.set("existing", {
      id: "existing", displayName: "IM - Arco Angarano 10 - Centro", fullAddress: "Arco Angarano 10, 70032 BITONTO (BA)",
      cadastral: { ...property().cadastral, parcel: "999" },
      owners: [{ linkId: "link-old", personId: "existing-owner", taxCode: "RSSMRA80A01A893P", sharePercentage: 100, rightType: "Proprietà" }],
    });
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run(property());

    expect(outcome.state).toBe("completed");
    expect(crm.properties).toHaveLength(1);
    expect(crm.properties.get("existing")?.cadastral).toEqual(property().cadastral);
  });

  it("rimuove gli ex proprietari privati ma non tocca aziende e usufrutto", async () => {
    const crm = new FakeCrm();
    crm.properties.set("existing", {
      id: "existing", displayName: "IM - Arco Angarano 10 - Centro", fullAddress: property().fullAddress,
      cadastral: property().cadastral,
      owners: [
        { linkId: "old-link", personId: "former-owner", taxCode: "FRMOWN80A01A893D", sharePercentage: 100, rightType: "Proprietà" },
        { linkId: "company-link", personId: "company", taxCode: "01234567890", sharePercentage: 20, rightType: "Proprietà" },
        { linkId: "usufruct-link", personId: "usufruct", taxCode: "FRMGNN60A01A893Z", sharePercentage: 100, rightType: "Usufrutto" },
      ],
    });
    const outcome = await new ImportV2Engine(crm, new MemoryStore()).run(property());

    expect(outcome.state).toBe("completed");
    expect(crm.properties.get("existing")?.owners.map((owner) => owner.taxCode))
      .toEqual(["01234567890", "FRMGNN60A01A893Z", "RSSMRA80A01A893P", "VRDLCU82B02A893X"]);
  });

  it("recupera il blocco intermittente del dialog comproprietari", async () => {
    const crm = new FakeCrm();
    crm.replaceFailures = 2;
    const outcome = await new ImportV2Engine(crm, new MemoryStore(), { maxTransientAttempts: 3 }).run(property());

    expect(outcome.state).toBe("completed");
    expect(crm.recoveries).toBe(2);
    expect([...crm.properties.values()][0]?.owners).toHaveLength(2);
  });

  it("accantona un immobile dopo i tentativi e continua con il successivo", async () => {
    class OneBadPropertyCrm extends FakeCrm {
      override async replaceManagedOwnerships(propertyId: string, desired: OwnershipWrite[]) {
        if (propertyId === "crm-property-1") throw new ImportV2Error("dialog unavailable", "transient_portal", { retryable: true });
        return super.replaceManagedOwnerships(propertyId, desired);
      }
    }
    const crm = new OneBadPropertyCrm();
    const result = await runImportV2Batch(new ImportV2Engine(crm, new MemoryStore(), { maxTransientAttempts: 2 }), [property(), property("property-2")]);

    expect(result.quarantined.map((item) => item.itemId)).toEqual(["item-property-1"]);
    expect(result.completed.map((item) => item.itemId)).toEqual(["item-property-2"]);
    expect(result.paused).toBeNull();
  });

  it("collega tutti gli intestatari quando i comproprietari sono inclusi", async () => {
    const crm = new FakeCrm();
    const outcome = await new ImportV2Engine(crm, new MemoryStore(), { includeCoOwners: true }).run(property());

    expect(outcome.state).toBe("completed");
    const owners = (await crm.readProperty(outcome.crmPropertyId!)).owners;
    expect(owners.map((owner) => owner.role).sort()).toEqual(["Comproprietario", "Proprietario Principale"]);
    expect(crm.lastOwnershipOptions.keepUnlistedManagedOwners).toBeFalsy();
  });

  it("si ferma all'intestatario con la quota piu' alta quando i comproprietari sono esclusi", async () => {
    const crm = new FakeCrm();
    const source = property();
    source.owners[0]!.sharePercentage = 70;
    source.owners[1]!.sharePercentage = 30;
    const outcome = await new ImportV2Engine(crm, new MemoryStore(), { includeCoOwners: false }).run(source);

    expect(outcome.state).toBe("completed");
    expect(outcome.syncedPeople.map((person) => person.sourcePersonId)).toEqual(["property-1-mario"]);
    const owners = (await crm.readProperty(outcome.crmPropertyId!)).owners;
    expect(owners.map((owner) => owner.role)).toEqual(["Proprietario Principale"]);
    expect(crm.lastOwnershipOptions.keepUnlistedManagedOwners).toBe(true);
  });

  it("non scollega un comproprietario gia' presente quando i comproprietari sono esclusi", async () => {
    const crm = new FakeCrm();
    const included = await new ImportV2Engine(crm, new MemoryStore()).run(property());
    const propertyId = included.crmPropertyId!;
    expect((await crm.readProperty(propertyId)).owners).toHaveLength(2);

    const outcome = await new ImportV2Engine(crm, new MemoryStore(), { includeCoOwners: false }).run(property());

    expect(outcome.state).toBe("completed");
    const owners = (await crm.readProperty(propertyId)).owners;
    expect(owners.map((owner) => owner.role).sort()).toEqual(["Comproprietario", "Proprietario Principale"]);
  });

  it("racconta l'avanzamento di ogni immobile mentre la coda procede", async () => {
    const crm = new FakeCrm();
    const avanzamento: Array<{ propertyId: string; index: number; total: number; stage: string }> = [];
    const result = await runImportV2Batch(
      new ImportV2Engine(crm, new MemoryStore()),
      [property(), property("property-2")],
      (progress) => avanzamento.push({ ...progress }),
    );

    expect(result.completed).toHaveLength(2);
    expect(avanzamento.every((step) => step.total === 2)).toBe(true);
    // Ogni immobile percorre gli stadi in ordine e chiude con "completed",
    // che e' cio' che fa avanzare la barra.
    const primo = avanzamento.filter((step) => step.propertyId === "property-1");
    expect(primo.every((step) => step.index === 1)).toBe(true);
    expect(primo.map((step) => step.stage)).toEqual([
      "queued", "planned", "people_resolved", "people_synced", "property_resolved",
      "property_synced", "ownerships_synced", "verified", "activity_synced", "completed",
    ]);
    expect(avanzamento.filter((step) => step.propertyId === "property-2").at(-1))
      .toMatchObject({ index: 2, stage: "completed" });
  });

  it("mette in pausa l'intera coda soltanto per un errore globale di sessione", async () => {
    const crm = new FakeCrm();
    crm.sessionFailure = new ImportV2Error("session expired", "global_session", { global: true, retryable: true });
    const result = await runImportV2Batch(new ImportV2Engine(crm, new MemoryStore()), [property(), property("property-2")]);

    expect(result.paused?.itemId).toBe("item-property-1");
    expect(result.completed).toHaveLength(0);
  });
});
