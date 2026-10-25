import { importTimingReport } from "../src/territory/import-timing.js";

const [filename, ...args] = process.argv.slice(2);
if (!filename || args.some(arg => !arg.startsWith("--run=")) || args.length > 1) {
  throw new Error("Uso: npm run worker-v2:timings -- <file-import-v2-timings.jsonl> [--run=ID]");
}
const runId = args[0]?.slice("--run=".length);
if (runId === "") throw new Error("Specificare l'ID run dopo --run=");
console.log(JSON.stringify(await importTimingReport(filename, runId), null, 2));
