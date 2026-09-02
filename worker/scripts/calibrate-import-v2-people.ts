import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { personWriteModel } from "../src/import-v2/contacts.js";
import { TecnocloudUiV2Port } from "../src/import-v2/tecnocloud-ui-port.js";
import type { SourceOwner } from "../src/import-v2/model.js";
import { connectToCrmChrome } from "../src/services/chrome.js";

type TestData = {
  marker: string;
  people: Array<{
    fullName: string;
    taxCode: string;
    birthDate: string;
    birthPlace: string;
    birthProvince: string;
    duplicateMergeTest: boolean;
  }>;
};

const inputPath = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", ".runtime", "import-v2-authorized-test-data.json"));
const statePath = path.join(path.dirname(inputPath), "import-v2-people-calibration-state.json");
const input = JSON.parse(await readFile(inputPath, "utf8")) as TestData;
let state: { mergedIndexes: number[] } = { mergedIndexes: [] };
try {
  state = JSON.parse(await readFile(statePath, "utf8")) as typeof state;
} catch { /* First controlled run. */ }

const tabs = await connectToCrmChrome(
  process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222",
  "crmimmobiliarelightning",
);
const port = new TecnocloudUiV2Port(tabs.crmPage);
const outcomes: Array<{ index: number; before: number; after: number; mergeTested: boolean }> = [];

try {
  for (const [index, person] of input.people.entries()) {
    const source: SourceOwner = {
      sourcePersonId: `controlled-test-${index}`,
      taxCode: person.taxCode,
      fullName: person.fullName,
      birthDate: person.birthDate,
      birthPlace: person.birthPlace,
      birthProvince: person.birthProvince,
      rightType: "Proprieta",
      sharePercentage: 50,
      contacts: { phones: [], emails: [] },
      privateNotes: input.marker,
    };
    let matches = await port.searchPeopleByExactTaxCode(person.taxCode);
    const before = matches.length;
    const desired = personWriteModel(source, matches[0] ?? null);
    if (!matches.length) await port.createPerson(desired);
    else if (matches.length === 1) await port.overwritePerson(matches[0]!.id, desired);
    else await port.mergePeople({
      taxCode: person.taxCode,
      canonicalPersonId: matches[0]!.id,
      duplicatePersonIds: matches.slice(1).map((candidate) => candidate.id),
      fieldSelection: "all_left",
      desired,
    });
    matches = await port.searchPeopleByExactTaxCode(person.taxCode);
    if (matches.length !== 1) throw new Error(`Il nominativo di collaudo ${index + 1} non è univoco dopo il salvataggio`);

    let mergeTested = state.mergedIndexes.includes(index);
    if (person.duplicateMergeTest && !mergeTested) {
      await port.createPerson(personWriteModel(source, matches[0]!));
      matches = await port.searchPeopleByExactTaxCode(person.taxCode);
      if (matches.length !== 1) throw new Error(`Il merge di collaudo ${index + 1} non ha prodotto un solo nominativo`);
      state.mergedIndexes = [...new Set([...state.mergedIndexes, index])];
      await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
      mergeTested = true;
    }
    outcomes.push({ index, before, after: matches.length, mergeTested });
  }
  process.stdout.write(JSON.stringify({ completed: outcomes.length, outcomes }));
} finally {
  await tabs.browser.close().catch(() => undefined);
}
