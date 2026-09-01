/**
 * Nessuna costante del database arriva a schermo.
 *
 * Il test del sistema di design guarda il codice sorgente: trova i colori
 * scritti a mano e le pagine senza titolo, ma non può sapere che
 * `publication.sourceRecordCreatedAt` finisce dentro un `<span>` perché un
 * dizionario non aveva quella chiave. Quello si vede solo a pagina renderizzata.
 *
 * Questo script apre ogni pagina con dati veri e cerca due cose: le costanti
 * in MAIUSCOLO_CON_UNDERSCORE e le parole inglesi che erano rimaste nei nomi
 * dei comandi. Serve un server già avviato:
 *
 *   AUTH_REQUIRED=false npx next dev -p 3132
 *   node scripts/check-screen-language.mjs
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.LR_BASE_URL ?? "http://localhost:3132";

/* Le pagine che una persona apre davvero, con un esempio per ogni scheda. */
const ROTTE = [
  "/dashboard",
  "/fonti",
  "/incoming",
  "/reports",
  "/listings",
  "/lifecycle",
  "/lifecycle/opportunities",
  "/lifecycle/private",
  "/lifecycle/review",
  "/matching",
  "/matching/overview",
  "/requests",
  "/portfolio",
  "/portfolio/ascensori",
  "/zones",
  "/map",
  "/matching-settings",
  "/settings",
];

/* Quello che a schermo può restare in inglese: sono nomi di cose vere. */
const AMMESSE = new Set(["EXTENSION_API_TOKEN"]);

const chromePath = [
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
].find(existsSync);

const browser = await chromium.launch({
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const problemi = [];

for (const rotta of ROTTE) {
  const errori = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (error) => errori.push(error.message.slice(0, 140)));

  await page.goto(BASE + rotta, { waitUntil: "networkidle", timeout: 180_000 });
  await page.waitForTimeout(600);

  const testo = await page.evaluate(() => document.body.innerText);
  const costanti = [...new Set(testo.match(/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/g) ?? [])].filter(
    (parola) => !AMMESSE.has(parola),
  );
  const inglese = [
    ...new Set(
      testo.match(
        /\b(Dashboard|Overview|Score|Refresh|Loading|Settings|Review|Pending|Failed|Success|Update All|Matching)\b/g,
      ) ?? [],
    ),
  ];
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  if (costanti.length || inglese.length || errori.length || overflow) {
    problemi.push({ rotta, costanti, inglese, errori, overflow });
  }
}

await browser.close();

if (problemi.length) {
  console.error(JSON.stringify(problemi, null, 2));
  console.error("\nQueste pagine mostrano ancora linguaggio da database, o non stanno nello schermo.");
  process.exit(1);
}

console.log(`${ROTTE.length} pagine controllate: nessuna costante del database a schermo.`);
