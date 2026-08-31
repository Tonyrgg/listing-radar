export type BrowserPageIdentity = {
  title?: string;
  url?: string;
};

export type WorkerPortal = "sister" | "crm";

const PORTAL_FALLBACKS: Record<WorkerPortal, RegExp[]> = {
  sister: [
    /sister\d*\.agenziaentrate\.gov\.it/i,
    /\bsister\b/i,
  ],
  crm: [
    /tecnocasa-group\.my\.site\.com\/crmimmobiliare/i,
    /crmimmobiliarelightning/i,
  ],
};

export function browserPageText(page: BrowserPageIdentity) {
  return `${page.title ?? ""} ${page.url ?? ""}`.toLocaleLowerCase("it");
}

/**
 * The saved match remains useful for custom installations, but it must not be
 * the only way to recognise the two known portals. The desktop health badge
 * has always accepted their stable domains; run startup must use the same
 * rule, otherwise the UI can say "ready" while connectToChrome rejects the
 * exact same tabs.
 */
export function matchesWorkerPortal(
  page: BrowserPageIdentity,
  configuredMatch: string,
  portal: WorkerPortal,
) {
  const text = browserPageText(page);
  const configured = configuredMatch.trim().toLocaleLowerCase("it");
  return Boolean(configured && text.includes(configured))
    || PORTAL_FALLBACKS[portal].some((pattern) => pattern.test(text));
}
