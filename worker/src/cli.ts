#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runChecks } from "./check.js";
import { logger } from "./logger.js";
import { PropertyWorkerRunner } from "./services/runner.js";
import type { WorkerMode } from "./types.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2] ?? "start";
  const config = loadConfig();
  if (command === "check") {
    const results = await runChecks(config);
    for (const item of results) process.stdout.write(`${item.ok ? "✓" : "✗"} ${item.name}: ${item.detail}\n`);
    // La connessione CDP mantiene un socket aperto: termina il check senza chiudere Chrome.
    process.exit(results.some((item) => !item.ok) ? 1 : 0);
  }
  const modeArg = argument("mode");
  const mode = modeArg === "automatic" || modeArg === "assisted" ? modeArg as WorkerMode : undefined;
  const jobId = argument("job-id");
  if (command === "resume" && !jobId) throw new Error("Uso: npm run worker:resume -- --job-id=<uuid>");
  const runner = new PropertyWorkerRunner(config);
  const completedJobId = await runner.run({ mode, jobId });
  process.stdout.write(`Job ${completedJobId} completato.\n`);
}

main().catch((error) => {
  logger.error({ err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, "Worker arrestato");
  process.exitCode = 1;
});
