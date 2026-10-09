/* One outline vocabulary, always paired with a visible label. */
const paths = {
  street: '<path d="m3 18 6-12 6 12 6-12M7 12h10"/>',
  home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
  users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2"/>',
  history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  refresh: '<path d="M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5m-4 9a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v4m0 4h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01m3 0h.01"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  filter: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
  note: '<path d="M5 3h14v14l-4 4H5zM15 21v-4h4M8 7h8M8 11h8"/>',
  pencil: '<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15z"/>',
  save: '<path d="M4 3h13l4 4v14H3V3h1M7 3v6h10V3M7 21v-7h10v7"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  play: '<path d="m7 3 14 9-14 9z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  selection: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  link: '<path d="m10 13 4-4m-5 8-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 6a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export function icon(name) {
  return `<svg class="ui-icon" data-icon="${name}" aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}
const labels = [
  [/^Acquisisci via$/, "download"], [/^Confronta (gestionale|selezionati)/, "search"],
  [/^(Applica selezionati|Prova piano)/, "play"], [/^Riprendi/, "play"], [/^Metti in pausa/, "pause"],
  [/^Immobili \d+$/, "building"], [/^Storico$/, "history"], [/^Seleziona tutti/, "selection"],
  [/^Deseleziona$/, "close"], [/^Apri (scheda|immobile)$/, "home"],
  [/^Filtri della prossima acquisizione$/, "filter"], [/^Opzioni (del prossimo import|dell’applicazione)$/, "settings"],
  [/^Annotazioni/, "note"], [/^Dati immobile e acquisizioni$/, "building"],
  [/^(Storico dell’immobile|Acquisizioni precedenti|Lavorazioni precedenti)/, "history"],
  [/^Correggi i dati conservati$/, "pencil"], [/^Distribuzione e acquisizione$/, "layers"],
  [/^(Salva (note|correzioni|query|combinazione|gruppo)|Nome per salvare)/, "save"],
  [/^(Collega il tracciato|Conferma associazione)/, "link"], [/^Intestatari verificati/, "users"],
  [/^(Aggiorna (scheda|vista)|Archivio sincronizzato|Sincronizzazione)/, "refresh"],
  [/^Apri Chrome/, "browser"], [/^Query immobili$/, "filter"], [/^Centra Bitonto$/, "pin"],
  [/^Mostra immobili$/, "search"], [/^Gestisci zone di vie/, "street"],
  [/^Territorio$/, "street"], [/^Proprietari e immobili$/, "users"], [/^Importazione$/, "download"],
];
export function labelIcons(root) {
  for (const element of root.querySelectorAll("button, summary, legend")) {
    if (element.querySelector(":scope > .ui-icon")) continue;
    const entry = labels.find(([pattern]) => pattern.test(element.textContent.trim()));
    if (entry) { element.insertAdjacentHTML("afterbegin", icon(entry[1])); element.classList.add("icon-label"); }
  }
}
