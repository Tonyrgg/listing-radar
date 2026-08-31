/**
 * Verifica la firma degli artefatti Windows prodotti dalla build.
 *
 * Due livelli, entrambi obbligatori quando l'host e' Windows:
 *
 * 1. controllo PE, indipendente dal sistema operativo: la tabella dei
 *    certificati esiste e contiene una entry Authenticode;
 * 2. `Get-AuthenticodeSignature`, che e' l'unica fonte affidabile per catena,
 *    scadenza, timestamp e subject.
 *
 * Su un host non Windows il secondo livello non e' eseguibile: lo script lo
 * dichiara e, se invocato con `--require-windows`, fallisce invece di far
 * passare una verifica parziale per una verifica completa.
 *
 * Uso:
 *   tsx scripts/verify-installer-signature.ts --publisher="CN=..." <file...>
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describeAuthenticodePresence } from "./authenticode.js";

const execFileAsync = promisify(execFile);

interface WindowsSignatureReport {
  status: string;
  statusMessage: string;
  subject: string | null;
  issuer: string | null;
  notBefore: string | null;
  notAfter: string | null;
  timestampSubject: string | null;
  timestampTime: string | null;
  thumbprint: string | null;
}

interface Options {
  files: string[];
  expectedPublisher: string | null;
  requireWindows: boolean;
}

function parseArguments(argv: string[]): Options {
  const files: string[] = [];
  let expectedPublisher: string | null = null;
  let requireWindows = false;
  for (const argument of argv) {
    if (argument.startsWith("--publisher=")) expectedPublisher = argument.slice("--publisher=".length).trim();
    else if (argument === "--require-windows") requireWindows = true;
    else if (argument.startsWith("--")) throw new Error(`Argomento non riconosciuto: ${argument}`);
    else files.push(argument);
  }
  if (files.length === 0) throw new Error("Indica almeno un file da verificare.");
  return { files, expectedPublisher, requireWindows };
}

/**
 * PowerShell restituisce l'esito di Get-AuthenticodeSignature come JSON, cosi'
 * il confronto avviene su campi strutturati e non sul testo localizzato.
 */
async function readWindowsSignature(file: string): Promise<WindowsSignatureReport> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$signature = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)}`,
    "$result = [ordered]@{",
    "  status = [string]$signature.Status",
    "  statusMessage = [string]$signature.StatusMessage",
    "  subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }",
    "  issuer = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Issuer } else { $null }",
    "  notBefore = if ($signature.SignerCertificate) { $signature.SignerCertificate.NotBefore.ToUniversalTime().ToString('o') } else { $null }",
    "  notAfter = if ($signature.SignerCertificate) { $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString('o') } else { $null }",
    "  thumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }",
    "  timestampSubject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { $null }",
    "  timestampTime = if ($signature.SignerCertificate -and $signature.TimeStamperCertificate) { (Get-Date).ToUniversalTime().ToString('o') } else { $null }",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim()) as WindowsSignatureReport;
}

/**
 * Il timestamp e' la ragione per cui una release resta verificabile dopo la
 * scadenza del certificato: la sua assenza e' un errore, non un dettaglio.
 */
function assertWindowsSignature(file: string, report: WindowsSignatureReport, expectedPublisher: string | null) {
  const failures: string[] = [];
  if (report.status !== "Valid") failures.push(`stato firma "${report.status}": ${report.statusMessage}`);
  if (!report.subject) failures.push("certificato firmatario assente");
  if (!report.timestampSubject) failures.push("firma priva di timestamp RFC 3161");

  if (report.notAfter) {
    const expiry = Date.parse(report.notAfter);
    if (Number.isFinite(expiry) && expiry <= Date.now()) failures.push(`certificato scaduto il ${report.notAfter}`);
  } else {
    failures.push("data di scadenza del certificato non leggibile");
  }

  if (expectedPublisher && report.subject && normalize(report.subject) !== normalize(expectedPublisher)) {
    failures.push(`publisher "${report.subject}" diverso da quello configurato "${expectedPublisher}"`);
  }

  if (failures.length > 0) {
    throw new Error(`Firma non valida per ${path.basename(file)}:\n  - ${failures.join("\n  - ")}`);
  }
}

function normalize(subject: string) {
  return subject.replace(/\s+/g, " ").trim().toLowerCase();
}

async function verifyFile(file: string, options: Options, onWindows: boolean) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`File da verificare non trovato: ${file}`);

  const contents = await readFile(file);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const presence = describeAuthenticodePresence(contents);

  console.log(`\n${path.basename(file)}`);
  console.log(`  dimensione : ${info.size} byte`);
  console.log(`  sha256     : ${sha256}`);
  console.log(`  header PE  : ${presence.summary}`);

  if (!presence.signed) {
    throw new Error(`${path.basename(file)} non contiene alcuna firma Authenticode.`);
  }

  if (!onWindows) {
    console.log("  windows    : verifica catena/timestamp non eseguibile su questo host");
    return;
  }

  const report = await readWindowsSignature(file);
  assertWindowsSignature(file, report, options.expectedPublisher);
  console.log(`  stato      : ${report.status}`);
  console.log(`  subject    : ${report.subject}`);
  console.log(`  issuer     : ${report.issuer}`);
  console.log(`  validita'  : ${report.notBefore} -> ${report.notAfter}`);
  console.log(`  timestamp  : ${report.timestampSubject}`);
  console.log(`  thumbprint : ${report.thumbprint}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const onWindows = process.platform === "win32";
  if (options.requireWindows && !onWindows) {
    throw new Error(
      "Verifica completa richiesta ma l'host non e' Windows: catena, scadenza e timestamp non sono controllabili qui.",
    );
  }
  if (!onWindows) {
    console.log("Host non Windows: viene eseguito soltanto il controllo strutturale dell'header PE.");
  }
  if (!options.expectedPublisher && onWindows) {
    console.log("Nessun --publisher indicato: il subject viene mostrato ma non confrontato.");
  }

  for (const file of options.files) {
    await verifyFile(file, options, onWindows);
  }
  console.log(`\nVerifica firma completata su ${options.files.length} file.`);
}

try {
  await main();
} catch (error) {
  // Una firma assente o non valida e' un esito previsto di questo controllo,
  // non un bug: va riportata come messaggio leggibile, non come stack trace.
  console.error(`\nVerifica firma fallita.\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
