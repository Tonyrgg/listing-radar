/**
 * Esegue electron-builder con la configurazione di firma risolta dall'ambiente.
 *
 * La configurazione `build` vive in package.json. Invece di passare override
 * puntuali sulla riga di comando (`-c.win....`), che yargs convertirebbe sempre
 * in stringhe e non permetterebbe di scrivere array o booleani, questo script
 * legge quel blocco, vi fonde il piano di firma e passa il risultato completo a
 * electron-builder con `--config`. E' la stessa configurazione della build non
 * firmata, piu' le sole chiavi di firma.
 *
 * Il file temporaneo non contiene segreti: endpoint, publisher e profilo non
 * sono credenziali. Le credenziali restano nell'ambiente del processo, dove
 * electron-builder e il modulo TrustedSigning le leggono da soli.
 *
 * Uso:
 *   tsx scripts/build-signed-installer.ts [--target=nsis]
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SigningConfigurationError,
  describeSigningPlan,
  mergeSigningIntoBuildConfig,
  resolveWindowsSigningPlan,
} from "./windows-signing.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseTarget(argv: string[]) {
  const raw = argv.find((argument) => argument.startsWith("--target="));
  const target = raw ? raw.slice("--target=".length).trim() : "nsis";
  if (target !== "nsis" && target !== "portable") {
    throw new Error(`Target non supportato: ${target}. Usa nsis oppure portable.`);
  }
  return target;
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: workerRoot, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} e' uscito con codice ${code}.`));
    });
  });
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  const plan = resolveWindowsSigningPlan(process.env);

  if (plan.mode === "unsigned") {
    throw new SigningConfigurationError(
      "build-signed-installer richiede una modalita' di firma. Per una build locale non firmata usa `npm run desktop:build`.",
    );
  }
  if (plan.requiresWindowsHost && process.platform !== "win32") {
    throw new SigningConfigurationError(
      `La firma ${plan.mode} richiede un host Windows: signtool e il modulo TrustedSigning non esistono altrove.`,
    );
  }

  console.log(describeSigningPlan(plan));

  const packageData = JSON.parse(await readFile(path.join(workerRoot, "package.json"), "utf8"));
  const buildConfig = packageData.build;
  if (!buildConfig || typeof buildConfig !== "object") {
    throw new Error("package.json non contiene il blocco `build` di electron-builder.");
  }

  const mergedConfig = mergeSigningIntoBuildConfig(buildConfig, plan);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "listing-radar-signing-"));
  const configPath = path.join(temporaryDirectory, "electron-builder.signed.json");

  try {
    await writeFile(configPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    // `--publish never`: la pubblicazione resta a publish-update.mjs, che
    // verifica commit, worktree e asset prima di rendere pubblica la bozza.
    await run("npx", ["electron-builder", "--win", target, "--config", configPath, "--publish", "never"]);
    console.log(`\nBuild firmata completata (${plan.mode}, target ${target}).`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SigningConfigurationError) {
    console.error(`\nConfigurazione di firma non valida.\n${error.message}`);
    process.exit(1);
  }
  throw error;
}
