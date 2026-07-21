import { access } from "node:fs/promises";

import type { WorkerConfig } from "./config.js";
import { PlaywrightCrmAdapter } from "./adapters/crm/index.js";
import { ExcelContactsAdapter, REQUIRED_CONTACT_COLUMNS } from "./adapters/excel/index.js";
import { PlaywrightSisterAdapter } from "./adapters/sister/index.js";
import { connectToChrome, isPresumablyAuthenticated } from "./services/chrome.js";
import { WorkerRepository } from "./services/repository.js";

export type CheckResult = { name: string; ok: boolean; detail: string };

export async function runChecks(config: WorkerConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    await access(config.CONTACTS_EXCEL_PATH);
    results.push({ name: "File Excel", ok: true, detail: config.CONTACTS_EXCEL_PATH });
    const adapter = new ExcelContactsAdapter(config.CONTACTS_EXCEL_PATH);
    await adapter.load();
    results.push({ name: "Colonne Excel", ok: true, detail: REQUIRED_CONTACT_COLUMNS.join(", ") });
  } catch (error) {
    results.push({ name: "File/colonne Excel", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    const repository = new WorkerRepository(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    await repository.healthCheck();
    results.push({ name: "Supabase", ok: true, detail: "Connessione e migration disponibili" });
  } catch (error) {
    results.push({ name: "Supabase", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  try {
    const tabs = await connectToChrome(config.CHROME_CDP_URL, config.SISTER_TAB_MATCH, config.CRM_TAB_MATCH);
    results.push({ name: "Chrome CDP", ok: true, detail: `${tabs.pages.length} schede aperte` });
    for (const tab of tabs.pages) results.push({ name: "Scheda", ok: true, detail: `${tab.title || "(senza titolo)"} — ${tab.url}` });
    results.push({ name: "Sessione SISTER", ok: isPresumablyAuthenticated(tabs.sisterPage), detail: isPresumablyAuthenticated(tabs.sisterPage) ? "presumibilmente attiva" : "pagina di accesso rilevata" });
    results.push({ name: "Sessione CRM", ok: isPresumablyAuthenticated(tabs.crmPage), detail: isPresumablyAuthenticated(tabs.crmPage) ? "presumibilmente attiva" : "pagina di accesso rilevata" });
    try {
      const recognized = await new PlaywrightSisterAdapter(tabs.sisterPage).detectPage();
      results.push({ name: "Pagina SISTER", ok: recognized, detail: recognized ? "pagina risultati riconosciuta" : "pagina non riconosciuta" });
    } catch (error) {
      results.push({ name: "Pagina SISTER", ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
    try {
      const recognized = await new PlaywrightCrmAdapter(tabs.crmPage, true).detectPage();
      results.push({ name: "Pagina CRM", ok: recognized, detail: recognized ? "pagina gestionale riconosciuta" : "pagina non riconosciuta" });
    } catch (error) {
      results.push({ name: "Pagina CRM", ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    results.push({ name: "Chrome/schede", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return results;
}
