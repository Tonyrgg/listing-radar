import { loadConfig } from "../src/config.js";
import { WorkerRepository } from "../src/services/repository.js";

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

const summary = await repository.backfillPortfolioPropertyLocations(({ index, total, resolution }) => {
  const zone = resolution.zone_number ? `zona ${resolution.zone_number} · ${resolution.zone_name}` : resolution.status;
  console.log(`[${index}/${total}] ${resolution.street_name ?? "via non riconosciuta"} → ${zone}`);
});

console.log(JSON.stringify(summary, null, 2));
