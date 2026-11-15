import { collectPrivateRadar } from "../src/lib/property-lifecycle/private-radar/collector";
import { closeSourceBrowser } from "../src/lib/http/browser-fallback";
import { getSupabaseServiceClient } from "../src/lib/supabase/service";
async function main() {
 if (!process.argv.includes("--apply")) throw new Error("Explicit --apply required: use the read-only agency probe for inspection");
 if (process.env.LIFECYCLE_PRIVATE_RADAR !== "true") throw new Error("LIFECYCLE_PRIVATE_RADAR must be enabled after migration 0101");
 const ref = process.argv.find(v=>v.startsWith("--confirm-project="))?.split("=")[1];
 const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost").hostname;
 if (!["localhost","127.0.0.1"].includes(host) && (!ref || host.split(".")[0] !== ref)) throw new Error("Matching --confirm-project required for a remote target");
 try { await collectPrivateRadar(getSupabaseServiceClient()); }
 finally { await closeSourceBrowser(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Radar failed"); process.exitCode = 1; });
