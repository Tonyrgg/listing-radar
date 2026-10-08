import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { HistorySnapshot } from "./history-source.js";
import type { PropertyMemory } from "../import-v2/memory-store.js";
import { unitKey } from "./model.js";

const directory = (profile: string) => path.join(profile, "acquisition-inbox");
/** Durable handoff: ordinary acquisitions survive an unavailable V2 or cloud. */
export async function queueAcquisition(profile: string, snapshot: HistorySnapshot) {
  if (snapshot.version !== 1 || snapshot.readOnly !== true) throw new Error("Acquisizione non riconosciuta");
  await mkdir(directory(profile), { recursive: true });
  for (const entry of snapshot.jobs) {
    const name = createHash("sha256").update(entry.job.id).digest("hex");
    const file = path.join(directory(profile), `${name}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...snapshot, jobs: [entry] }), { mode: 0o600 });
    await rename(temporary, file);
  }
}
export async function consumeAcquisitions(profile: string, adopt: (snapshot: HistorySnapshot) => Promise<unknown>) {
  let files: string[];
  try { files = (await readdir(directory(profile))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  let consumed = 0;
  for (const name of files) {
    const file = path.join(directory(profile), name), payload = await readFile(file, "utf8");
    const snapshot = JSON.parse(payload) as HistorySnapshot;
    await adopt(snapshot);
    // A newer handoff arriving during adoption must remain in the inbox.
    if (await readFile(file, "utf8") === payload) await unlink(file);
    consumed++;
  }
  return consumed;
}

/** One immutable file per property fact; parallel lanes cannot overwrite each other. */
export async function queuePropertyMemory(profile: string, memory: PropertyMemory) {
  const folder = path.join(profile, "property-inbox"); await mkdir(folder, { recursive: true });
  const content = JSON.stringify(memory), name = createHash("sha256").update(content).digest("hex");
  const file = path.join(folder, `${name}.json`), temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, file);
}
export async function consumePropertyMemory(profile: string, adopt: (memory: PropertyMemory) => Promise<void>) {
  const folder = path.join(profile, "property-inbox"); let files: string[];
  try { files = (await readdir(folder)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  const records = await Promise.all(files.map(async name => ({ file: path.join(folder, name), value: JSON.parse(await readFile(path.join(folder, name), "utf8")) as PropertyMemory })));
  records.sort((a, b) => Date.parse(a.value.at) - Date.parse(b.value.at));
  for (const record of records) {
    if (record.value.version !== 1) throw new Error("Memoria immobile non riconosciuta");
    try { unitKey(record.value.source); if (record.value.source.municipality.trim().toUpperCase() !== "BITONTO") throw new Error("Fuori perimetro"); }
    catch {
      // Keep the full fact for recovery without blocking all valid properties.
      const unresolved = path.join(profile, "property-unresolved"); await mkdir(unresolved, { recursive: true });
      await rename(record.file, path.join(unresolved, path.basename(record.file))); continue;
    }
    await adopt(record.value); await unlink(record.file);
  }
  return records.length;
}
