import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { HistorySnapshot } from "./history-source.js";

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
