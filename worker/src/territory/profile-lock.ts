import { openSync, writeFileSync, readFileSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Owner = { pid: number; token: string };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } };
const owner = (file: string): Owner => {
  const data = JSON.parse(readFileSync(file, "utf8")) as Owner;
  if (!Number.isInteger(data.pid) || data.pid < 1 || typeof data.token !== "string") throw new Error("Blocco del profilo non riconosciuto; archivio conservato");
  return data;
};
/** One writer across Electron and CLI; a stale-lock recovery is itself exclusive. */
export function lockTerritoryProfile(directory: string) {
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "territory-writer.lock");
  const recoveryFile = `${filename}.recovery`;
  const claim = { pid: process.pid, token: randomUUID() };
  const acquire = () => { const descriptor = openSync(filename, "wx", 0o600); try { writeFileSync(descriptor, JSON.stringify(claim)); } finally { closeSync(descriptor); } };
  try { acquire(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (alive(owner(filename).pid)) throw new Error("Il profilo Territorio è aperto. Chiudi il laboratorio prima di importare o sincronizzare l'archivio.");
    let descriptor: number;
    try { descriptor = openSync(recoveryFile, "wx", 0o600); } catch { throw new Error("Recupero del profilo in corso; riprova senza modificare l'archivio"); }
    try {
      try { if (!alive(owner(filename).pid)) unlinkSync(filename); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      acquire();
    } finally { closeSync(descriptor); unlinkSync(recoveryFile); }
  }
  let released = false;
  return () => { if (released) return; if (owner(filename).token === claim.token) unlinkSync(filename); released = true; };
}
