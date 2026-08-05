import { loadConfig } from "../src/config.js";
import { RequestArchiveImporter } from "../src/services/request-archive-importer.js";
import { WorkerRepository } from "../src/services/repository.js";

const config = loadConfig();
const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
const importer = new RequestArchiveImporter(config, repository, {
  onEvent(event) {
    if (event.type === "index") console.log(`[indice] pagina ${event.page} · ${event.discovered} richieste`);
    if (event.type === "progress") console.log(`[${event.index}/${event.total}] ${event.title} · errori ${event.failed}`);
    if (event.type === "complete") console.log(JSON.stringify(event.run, null, 2));
  },
});

await importer.run(process.argv[2]);
