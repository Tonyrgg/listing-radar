const STEPS = [
  "ready",
  "sister_results_acquired",
  "properties_extracted",
  "owners_extracted",
  "data_normalized",
  "acquisition_reviewed",
  "properties_processed",
  "verified",
  "completed",
];
const PHASES = [
  {
    key: "prepare",
    label: "Preparazione",
    detail: "Apro e controllo i collegamenti",
  },
  {
    key: "read",
    label: "Leggo tutti i dati",
    detail: "Immobili, proprietari e quote da SISTER",
  },
  {
    key: "review",
    label: "Ti mostro il riepilogo",
    detail: "Controlli tutto prima di proseguire",
  },
  {
    key: "work",
    label: "Completo un immobile alla volta",
    detail: "Tutti i proprietari, immobile, attività e quote",
  },
  {
    key: "finish",
    label: "Controllo e termino",
    detail: "Verifico che non manchi nulla",
  },
];
const GUIDE = {
  ready: {
    label: "Preparazione",
    doing:
      "Controllo che Chrome, SISTER, gestionale ed Excel siano raggiungibili.",
    next: "Quando tutto è pronto, ti chiederò di acquisire i risultati SISTER.",
  },
  sister_results_acquired: {
    label: "Lettura SISTER",
    doing: "Sto leggendo la pagina dei risultati che hai già aperto.",
    next: "Individuerò solo gli immobili delle categorie A/ e C/.",
  },
  properties_extracted: {
    label: "Raccolta immobili",
    doing:
      "Sto raccogliendo foglio, particella, subalterno, indirizzo e dati catastali.",
    next: "Per ogni immobile aprirò l’elenco dei proprietari.",
  },
  owners_extracted: {
    label: "Raccolta proprietari",
    doing:
      "Sto leggendo nominativi, codici fiscali, diritti e quote di proprietà, una riga alla volta.",
    next: "Verificherò tutti i proprietari e creerò soltanto quelli assenti dal gestionale.",
  },
  data_normalized: {
    label: "Controllo dati",
    doing:
      "Sto uniformando codici fiscali, quote e chiavi catastali per evitare duplicati.",
    next: "Ti mostrerò un riepilogo completo prima del confronto col gestionale.",
  },
  acquisition_reviewed: {
    label: "Riepilogo acquisizione",
    doing:
      "I dati SISTER sono raccolti. Attendo il tuo controllo del riepilogo.",
    next: "Dopo la conferma completerò il primo immobile con tutti i suoi proprietari, poi passerò al successivo.",
  },
  properties_processed: {
    label: "Lavorazione degli immobili",
    doing:
      "Completo un immobile alla volta sotto il nominativo con la quota di proprietà più alta.",
    next: "Verifico tutti i proprietari, creo l'immobile e l'attività, poi collego i comproprietari con le rispettive quote.",
  },
  person_searched: {
    label: "Ricerca nominativi",
    doing:
      "Cerco ogni persona nel gestionale soltanto per codice fiscale e aggiorno l’anagrafica verificata.",
    next: "Se non esiste, preparerò una nuova scheda; se esiste, sostituirò i dati anagrafici conservando i recapiti.",
  },
  person_created_or_updated: {
    label: "Aggiornamento nominativi",
    doing:
      "Sto creando o aggiornando le schede delle persone senza duplicare i recapiti.",
    next: "Controllerò eventuali unioni proposte dal gestionale.",
  },
  person_merge_reviewed: {
    label: "Controllo unioni",
    doing:
      "Verifico che gli eventuali merge del gestionale siano conclusi senza conflitti.",
    next: "Aprirò gli immobili collegati ai nominativi.",
  },
  property_searched: {
    label: "Ricerca immobili",
    doing:
      "Cerco l’immobile dentro la scheda del proprietario, confrontando prima dati catastali e poi via e civico.",
    next: "Se lo trovo aggiorno i dati; altrimenti preparo una nuova scheda immobile.",
  },
  property_created_or_updated: {
    label: "Aggiornamento immobili",
    doing:
      "Sto completando i dati catastali dell’immobile usando SISTER come fonte principale.",
    next: "Creerò una sola attività direttamente dalla scheda dell’immobile.",
  },
  activity_created: {
    label: "Attività sugli immobili",
    doing:
      "Sto aggiungendo l’attività “Da eseguire” dalla scheda di ciascun immobile, non dal cliente.",
    next: "Poi abbinerò i recapiti del file Excel.",
  },
  contacts_matched: {
    label: "Recapiti Excel",
    doing:
      "Cerco il codice fiscale nel file Excel e raccolgo telefoni ed email senza duplicati.",
    next: "Aggiungerò i recapiti mancanti alle persone già individuate.",
  },
  owners_linked: {
    label: "Soggetti correlati",
    doing:
      "Collego i comproprietari verificati all’immobile con ruolo e quota.",
    next: "Eseguirò l’ultimo controllo di completezza su proprietari, immobile e attività.",
  },
  verified: {
    label: "Verifica finale",
    doing:
      "Controllo che immobili, persone, attività, recapiti e quote siano stati elaborati.",
    next: "Se non manca nulla, il lavoro sarà concluso.",
  },
  completed: {
    label: "Completato",
    doing: "La lavorazione è terminata e tutti i passaggi risultano salvati.",
    next: "Puoi aprire i dettagli oppure iniziare una nuova lavorazione.",
  },
};
const ERROR_STATES = new Set([
  "needs_review",
  "session_expired",
  "portal_error",
  "data_incomplete",
  "failed",
]);
let appState = null,
  checks = [],
  selectedMode = "assisted",
  toastTimer = null,
  pendingCancelJobId = null,
  cancelInFlight = false,
  resolutionDetail = null,
  resolutionJobId = null,
  pendingPropertyRemovalId = null,
  propertyRemovalInFlight = false,
  uiCommandSequence = 0,
  latestUiCommand = null,
  selectedRunSlide = "civic";
let completedImportsRenderKey = null,
  jobsRenderKey = null,
  lastRunRenderKey = null,
  importJobId = null,
  importActivityMode = null;
/* Firma dell'ultima riga disegnata nel diario e quante ne sono a schermo:
 * servono a capire quali righe sono nuove senza ridisegnare le altre. */
let attivitaCimaDisegnata = null,
  attivitaRigheDisegnate = 0,
  diagnosticiRenderKey = null;
const MAX_RIGHE_DIARIO = 300;
const COMMAND_CANCELLED = Symbol("command-cancelled");
const $ = (id) => document.getElementById(id);

const operationConsoleBody = $("operationConsoleBody");
for (const id of ["commandMonitor", "retryMonitor", "actionPanel", "manualCorrectionPanel", "progressPercent", "workflowSteps"]) {
  const element = $(id);
  if (!element || !operationConsoleBody) continue;
  if (id === "progressPercent" || id === "workflowSteps") continue;
  operationConsoleBody.append(element);
}
const progressCard = document.querySelector(".progress-card");
if (progressCard && operationConsoleBody) operationConsoleBody.append(progressCard);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const fmtTime = (value) =>
  value
    ? new Intl.DateTimeFormat("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const fmtDate = (value) =>
  value
    ? new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const guide = (step) =>
  GUIDE[step] ?? {
    label: String(step ?? "Elaborazione").replaceAll("_", " "),
    doing: "Il programma sta completando questo passaggio.",
    next: "L’avanzamento sarà salvato automaticamente.",
  };
/* Le sezioni di servizio restano chiuse finché non servono davvero.
 * Quando qualcosa punta al loro interno, la sezione si apre da sola. */
function revealSection(node) {
  if (!node) return null;
  if (node.tagName === "DETAILS") node.open = true;
  let parent = node.parentElement;
  while (parent) {
    if (parent.tagName === "DETAILS") parent.open = true;
    parent = parent.parentElement;
  }
  return node;
}
/* La pagina mostra una sezione per volta: prima di scorrere verso qualcosa
 * bisogna portare in vista la sezione che lo contiene, altrimenti si scorre
 * verso un nodo nascosto. Cio che non sta in una sezione di servizio
 * appartiene alla lavorazione. */
function goTo(id) {
  const node = revealSection(document.getElementById(id));
  if (!node) return;
  const view = node.closest("details.section")?.id ?? "operations";
  document.body.dataset.workerView = view;
  markActiveNav(view);
  node.scrollIntoView({ behavior: "smooth", block: "start" });
}
/* La tappa «Cronologia» dice quanto ha gia in memoria, come le altre tappe
 * dicono il proprio stato: e lo stesso numero mostrato dentro la sezione. */
function updateHistoryNavHint() {
  const hint = $("historyNavHint");
  if (!hint) return;
  const jobs = Number($("jobCount")?.textContent ?? 0);
  const imports = Number($("completedImportCount")?.textContent ?? 0);
  const total = jobs + imports;
  hint.textContent = total
    ? `${total} ${total === 1 ? "lavoro salvato" : "lavori salvati"}`
    : "Import conclusi e lavori salvati";
}
function markActiveNav(id) {
  document.querySelectorAll(".nav-item[data-scroll]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.scroll === id);
  });
}
function lockSecondaryPageActions(locked) {
  for (const id of ["sync", "history", "settings"]) {
    const section = $(id);
    if (!section) continue;
    section.inert = locked;
    section.toggleAttribute("data-operation-locked", locked);
  }
}
const RUN_SLIDES = ["civic", "street", "network"];
function setRunSlide(slide) {
  if (!RUN_SLIDES.includes(slide)) return;
  selectedRunSlide = slide;
  const index = RUN_SLIDES.indexOf(slide);
  document.querySelector(".run-carousel")?.setAttribute("data-active-slide", slide);
  document.querySelectorAll("[data-run-slide]").forEach((panel) => panel.classList.toggle("is-selected", panel.dataset.runSlide === slide));
  document.querySelectorAll("[data-run-status]").forEach((pill) => pill.classList.toggle("is-selected", pill.dataset.runStatus === slide));
  document.querySelectorAll("[data-run-slide-target]").forEach((button) => {
    const selected = button.dataset.runSlideTarget === slide;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    if (selected && button.dataset.runDescription && $("runModeDescription"))
      $("runModeDescription").textContent = button.dataset.runDescription;
  });
  if ($("runCarouselPosition")) $("runCarouselPosition").textContent = `${index + 1} di ${RUN_SLIDES.length}`;
}
function moveRunSlide(direction) {
  const current = RUN_SLIDES.indexOf(selectedRunSlide);
  const delta = direction === "previous" ? -1 : 1;
  setRunSlide(RUN_SLIDES[(current + delta + RUN_SLIDES.length) % RUN_SLIDES.length]);
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3500);
}
const fmtCount = (value) =>
  String(Math.max(0, Math.trunc(Number(value ?? 0)))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ".",
  );
function commandIdentity(target) {
  const action = target.dataset.updateAction
    ? `update-${target.dataset.updateAction}`
    : (target.dataset.action ??
      (target.dataset.runSlideTarget ? `run-slide-${target.dataset.runSlideTarget}` : null) ??
      (target.dataset.activityMode ? `activity-mode-${target.dataset.activityMode}` : null) ??
      (target.dataset.carouselDirection ? `carousel-${target.dataset.carouselDirection}` : null) ??
      (target.dataset.scroll
        ? `navigate-${target.dataset.scroll}`
        : target.dataset.mode
          ? `mode-${target.dataset.mode}`
          : target.dataset.prompt
            ? `prompt-${target.dataset.prompt}`
            : target.dataset.reviewDecision
              ? `review-${target.dataset.reviewDecision}`
              : target.dataset.skipProperty
                ? "skip-property"
                : target.dataset.resumeJob
                  ? "resume-job"
                  : target.dataset.detailJob
                    ? "job-details"
                    : target.dataset.completedSession
                      ? "completed-session"
                      : target.dataset.cancelJob
                        ? "cancel-job"
                        : target.dataset.cancelDialog
                          ? `cancel-dialog-${target.dataset.cancelDialog}`
                          : target.id || "button"));
  const explicit = {
      "activity-mode-direct_contact": "Attività: autocompila contatto diretto",
      "activity-mode-plain": "Attività: generica",
      "activity-mode-none": "Attività: nessuna",
      checkButton: "Controlla collegamenti",
      chromeButton: "Apri Chrome di lavoro",
      chooseExcelButton: "Scegli file Excel",
      openOperationLogButton: "Apri registro operativo",
      startButton: "Avvia lavorazione",
      streetRunStart: "Avvia acquisizione via completa",
      streetRegistryStart: "Lavora la prossima via del registro",
      streetRegistryRefresh: "Aggiorna la coda del registro",
      networkRegistryStart: "Avvia Rete proprietari dalle vie",
      networkRegistryPause: "Ferma Rete proprietari dopo la via corrente",
      networkRegistryRefresh: "Aggiorna il registro vie",
      streetRunCancel: "Metti in pausa acquisizione via",
      streetRunAbandon: "Ferma e abbandona acquisizione via",
      networkRunStart: "Esplora rete proprietaria",
      networkRunCancel: "Metti in pausa esplorazione rete",
      networkFilterReset: "Azzera i filtri della coda",
      "import-dialog-confirm": "Avvia l'import dell'acquisizione",
      "import-dialog-close": "Chiudi la finestra dell'import",
      stopAfterNextImportButton: "Ferma dopo il prossimo import",
      stopAllButton: "Ferma tutte le operazioni",
      requestArchiveStart: "Sincronizza archivio richieste",
      requestArchiveCancel: "Interrompi sincronizzazione richieste",
      requestArchiveNew: "Avvia nuova sincronizzazione richieste",
      mandateArchiveStart: "Sincronizza archivio incarichi",
      mandateArchiveCancel: "Interrompi sincronizzazione incarichi",
      mandateArchiveNew: "Avvia nuova sincronizzazione incarichi",
      completedImportsLoadMore: "Carica altre sessioni",
      softwareUpdateAction: "Gestisci aggiornamento",
      softwareUpdateCancel: "Interrompi download aggiornamento",
      updateButton: "Gestisci aggiornamento",
    },
    navigation = {
      operations: "Apri sezione Lavora",
      sync: "Apri sezione Sincronizza",
      history: "Apri sezione Cronologia",
      settings: "Apri sezione Impostazioni",
    };
  const label =
    explicit[target.id] ??
    (target.dataset.scroll ? navigation[target.dataset.scroll] : null) ??
    target.getAttribute("aria-label") ??
    target.textContent?.replace(/\s+/g, " ").trim() ??
    action;
  return { action, label: label.slice(0, 160) };
}
function reportUiAction(command, status, detail = null) {
  window.propertyWorker
    .recordUiAction?.({
      action: command.action,
      label: command.label,
      status,
      detail,
    })
    .catch(() => undefined);
}
function setUiCommand(command, status, detail) {
  latestUiCommand = {
    ...command,
    id: ++uiCommandSequence,
    status,
    detail,
    at: new Date().toISOString(),
  };
  renderCommandMonitor();
}
async function executeButtonCommand(target, command, work) {
  if (target.dataset.commandRunning === "true") {
    setUiCommand(command, "running", "Il comando è già in esecuzione");
    toast(`Comando già in esecuzione: ${command.label}`);
    return;
  }
  target.dataset.commandRunning = "true";
  target.setAttribute("aria-busy", "true");
  setUiCommand(command, "running", "Comando ricevuto, avvio in corso");
  toast(`Comando ricevuto: ${command.label}`);
  reportUiAction(command, "started");
  try {
    const result = await work();
    if (result === COMMAND_CANCELLED) {
      setUiCommand(
        command,
        "cancelled",
        "Operazione annullata prima dell’avvio",
      );
      reportUiAction(command, "cancelled");
      return;
    }
    setUiCommand(command, "completed", "Comando eseguito correttamente");
    reportUiAction(command, "completed");
    return result;
  } catch (error) {
    const detail = error?.message ?? String(error);
    setUiCommand(command, "failed", detail);
    reportUiAction(command, "failed", detail);
    toast(`Errore: ${detail}`);
    throw error;
  } finally {
    delete target.dataset.commandRunning;
    target.removeAttribute("aria-busy");
  }
}
function currentOperation() {
  const request = appState?.requestArchive,
    mandate = appState?.mandateArchive,
    street = appState?.streetRun,
    property = appState?.propertyProgress;
  if (appState?.stoppingAll)
    return {
      status: "warning",
      title: "Arresto globale in corso",
      detail:
        "Interrompo le operazioni attive e conservo soltanto gli stati recuperabili.",
      position: "Ferma tutto",
      percent: null,
    };
  if (appState?.pausingJobId)
    return {
      status: "warning",
      title: "Pausa richiesta e acquisita",
      detail:
        "Completo l’azione atomica corrente e salvo l’avanzamento prima di fermarmi.",
      position: "Arresto sicuro",
      percent: null,
    };
  if (appState?.skippingPropertyId && property)
    return {
      status: "warning",
      title: `Skip della voce ${fmtCount(property.index)} di ${fmtCount(property.total)}`,
      detail:
        property.address ??
        "Completo il passaggio atomico e continuo con la voce successiva.",
      position: `${fmtCount(property.index)}/${fmtCount(property.total)}`,
      percent: property.total ? (property.index / property.total) * 100 : null,
    };
  if (appState?.active && property)
    return {
      status: "running",
      title: `Importazione di ${fmtCount(property.total)} immobili`,
      detail: `Voce ${fmtCount(property.index)} di ${fmtCount(property.total)} · ${property.address ?? "Immobile senza indirizzo"} · ${property.message}`,
      position: `${fmtCount(property.index)}/${fmtCount(property.total)}`,
      percent: property.total
        ? ((property.index - 1) / property.total) * 100
        : null,
    };
  if (appState?.active) {
    const job = currentJob(),
      total = job?.total_properties ?? 0,
      processed = job?.processed_properties ?? 0;
    return {
      status: "running",
      title: total
        ? `Importazione programmata: ${fmtCount(total)} immobili`
        : guide(appState.currentStep).label,
      detail: total
        ? `Completati ${fmtCount(processed)} di ${fmtCount(total)} · ${guide(appState.currentStep).doing}`
        : guide(appState.currentStep).doing,
      position: total
        ? `${fmtCount(processed)}/${fmtCount(total)}`
        : "In corso",
      percent: total ? (processed / total) * 100 : null,
    };
  }
  if (street?.active) {
    const progress = street.progress,
      checkpoint = street.checkpoint,
      variantTotal =
        progress?.variantTotal ?? checkpoint?.variants?.length ?? 0,
      variantIndex =
        (progress?.variantIndex ?? checkpoint?.currentVariantIndex ?? 0) + 1,
      current = progress?.current ?? 0,
      total = progress?.total ?? 0;
    return {
      status: street.cancelling ? "warning" : "running",
      title: `Acquisizione via completa · variante ${fmtCount(variantIndex)} di ${fmtCount(variantTotal)}`,
      detail: total
        ? `Voce ${fmtCount(current)} di ${fmtCount(total)}${progress?.address ? ` · ${progress.address}` : ""}`
        : "Preparazione ed estrazione dell’elenco; civico ricavato dalla riga",
      position: total
        ? `${fmtCount(current)}/${fmtCount(total)}`
        : `${fmtCount(variantIndex)}/${fmtCount(variantTotal)}`,
      percent: total
        ? (current / total) * 100
        : variantTotal
          ? ((variantIndex - 1) / variantTotal) * 100
          : null,
    };
  }
  if (request?.active) {
    const p = request.progress;
    return {
      status: request.cancelling ? "warning" : "running",
      title: p?.total
        ? `Importazione di ${fmtCount(p.total)} richieste`
        : `Indicizzazione archivio richieste`,
      detail: p?.total
        ? `Voce ${fmtCount(p.index)} di ${fmtCount(p.total)} · ${p.title}`
        : (p?.title ?? "Ricerca di tutte le voci disponibili"),
      position: p?.total
        ? `${fmtCount(p.index)}/${fmtCount(p.total)}`
        : `Pagina ${fmtCount(p?.index ?? 0)}`,
      percent: p?.total ? (p.index / p.total) * 100 : null,
    };
  }
  if (mandate?.active) {
    const p = mandate.progress;
    return {
      status: mandate.cancelling ? "warning" : "running",
      title: p?.total
        ? `Importazione di ${fmtCount(p.total)} incarichi`
        : `Indicizzazione archivio incarichi`,
      detail: p?.total
        ? `Voce ${fmtCount(p.index)} di ${fmtCount(p.total)} · ${p.title}`
        : (p?.title ?? "Ricerca di tutte le voci disponibili"),
      position: p?.total
        ? `${fmtCount(p.index)}/${fmtCount(p.total)}`
        : `Pagina ${fmtCount(p?.index ?? 0)}`,
      percent: p?.total ? (p.index / p.total) * 100 : null,
    };
  }
  if (appState?.softwareUpdate?.status === "downloading")
    return {
      status: "running",
      title: "Scaricamento aggiornamento worker",
      detail: appState.softwareUpdate.message,
      position: `${Math.round(appState.softwareUpdate.percent ?? 0)}%`,
      percent: appState.softwareUpdate.percent ?? 0,
    };
  if (latestUiCommand) {
    const map = {
      running: "running",
      completed: "success",
      failed: "error",
      cancelled: "warning",
    };
    return {
      status: map[latestUiCommand.status] ?? "idle",
      title: latestUiCommand.label,
      detail: latestUiCommand.detail,
      position:
        latestUiCommand.status === "running"
          ? "In esecuzione"
          : latestUiCommand.status === "completed"
            ? "Eseguito"
            : latestUiCommand.status === "failed"
              ? "Errore"
              : "Annullato",
      percent: null,
    };
  }
  return {
    status: "idle",
    title: "In attesa di un comando",
    detail: "Ogni clic, avanzamento ed errore verrà mostrato qui.",
    position: "Pronto",
    percent: null,
  };
}
function renderCommandMonitor() {
  const monitor = $("commandMonitor");
  if (!monitor) return;
  const operation = currentOperation(),
    bar = $("commandMonitorProgress");
  monitor.className = `command-monitor is-${operation.status}`;
  $("commandMonitorTitle").textContent = operation.title;
  $("commandMonitorDetail").textContent = operation.detail;
  $("commandMonitorPosition").textContent = operation.position;
  bar.classList.toggle("is-hidden", operation.percent == null);
  bar.querySelector("span").style.width =
    `${Math.max(0, Math.min(100, operation.percent ?? 0))}%`;
}
function renderRunControls() {
  const canScheduleStop =
    Boolean(appState?.active) ||
    Boolean(appState?.streetRun?.active) ||
    Boolean(appState?.networkRun?.active) ||
    Boolean(appState?.requestArchive?.active) ||
    Boolean(appState?.mandateArchive?.active);
  const button = $("stopAfterNextImportButton");
  if (!button) return;
  const scheduled = Boolean(appState?.stopAfterNextImport);
  button.classList.toggle("is-hidden", !canScheduleStop);
  button.disabled = Boolean(appState?.stoppingAll);
  button.setAttribute("aria-pressed", String(scheduled));
  button.textContent = scheduled
    ? "Annulla stop programmato"
    : "Ferma dopo il prossimo import";
  $("stopAfterNextImportStatus").textContent = scheduled
    ? "Il prossimo import verrà concluso, poi la run verrà messa in pausa con il resto salvato."
    : canScheduleStop
      ? "Puoi richiedere la pausa in qualsiasi momento durante la run."
      : "Disponibile appena parte una run.";
}

function renderRetryMonitor() {
  const panel = $("retryMonitor"), telemetry = appState?.retryMonitor;
  if (!panel) return;
  panel.classList.toggle("is-hidden", !telemetry);
  if (!telemetry) return;

  const runLabels = {
    import: "Import immobili",
    street: "Long run via",
    network: "Esplorazione rete",
    requests: "Sincronizzazione richieste",
    mandates: "Sincronizzazione incarichi",
  };
  const maximum = Math.max(1, Number(telemetry.maximumAttempts) || 3);
  const attempt = Math.max(1, Math.min(maximum, Number(telemetry.attempt) || 1));
  const remainingSeconds = telemetry.nextRetryAt
    ? Math.max(0, Math.ceil((new Date(telemetry.nextRetryAt).getTime() - Date.now()) / 1000))
    : 0;
  const elapsedSeconds = telemetry.status === "running" && telemetry.updatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(telemetry.updatedAt).getTime()) / 1000))
    : 0;
  const clockSeconds = telemetry.status === "waiting" ? remainingSeconds : elapsedSeconds;
  const minutes = String(Math.floor(clockSeconds / 60)).padStart(2, "0");
  const seconds = String(clockSeconds % 60).padStart(2, "0");
  const labels = {
    running: [`Tentativo ${attempt} di ${maximum}`, "Il passaggio è in corso. Il timer misura da quanto sto lavorando."],
    waiting: [`Prossimo tentativo ${attempt} di ${maximum}`, `Riprovo automaticamente tra ${remainingSeconds} secondi.`],
    succeeded: ["Passaggio riuscito", `Completato al tentativo ${attempt} di ${maximum}.`],
    exhausted: ["Tentativi esauriti", `Il passaggio richiede attenzione dopo ${maximum} tentativi.`],
  };
  const [title, detail] = labels[telemetry.status] ?? labels.running;
  panel.className = `retry-monitor is-${telemetry.status}`;
  $("retryMonitorTitle").textContent = title;
  $("retryMonitorDetail").textContent = `${telemetry.operation}. ${detail}`;
  $("retryMonitorRunType").textContent = runLabels[telemetry.runType] ?? "Run";
  $("retryMonitorTimer").textContent = `${minutes}:${seconds}`;
  $("retryMonitorAttempts").innerHTML = Array.from({ length: maximum }, (_, index) => {
    const number = index + 1;
    const state = telemetry.status === "succeeded" && number === attempt
      ? "is-success"
      : telemetry.status === "exhausted" && number <= attempt
        ? "is-error"
        : number < attempt
          ? "is-complete"
          : number === attempt
            ? "is-current"
            : "";
    return `<li class="${state}"><span>${number}</span><small>${number === attempt ? "Ora" : number < attempt ? "Fatto" : "Pronto"}</small></li>`;
  }).join("");
}
function completedJobs() {
  return (appState?.completedImports ?? []).map((item) => item.job);
}
function currentJob() {
  return [...(appState?.jobs ?? []), ...completedJobs()].find(
    (job) => job.id === appState?.activeJobId,
  );
}

function errorAdvice(job, error) {
  const raw = String(error ?? job?.error_message ?? "");
  const text = raw.toLowerCase();
  const status = job?.status,
    details = job?.error_details ?? {},
    portalAction = String(details.action ?? ""),
    operation = String(details.operationLabel ?? "");
  if (
    portalAction === "job-graph-integrity" ||
    portalAction === "job-ownership-integrity" ||
    text.includes("006_property_worker_archives")
  )
    return {
      cause:
        "L’archivio dati non è ancora aggiornato alla versione richiesta dal programma.",
      steps: [
        "Non riprendere questa lavorazione: il programma l’ha fermata prima di modificare il gestionale.",
        "Applica la migration 006_property_worker_archives.sql al progetto Supabase condiviso.",
        "Dopo l’aggiornamento avvia una nuova acquisizione SISTER: i vecchi lavori incompleti non verranno riutilizzati.",
      ],
      action: "schema",
      operation: operation || "Controllo integrità della lavorazione",
    };
  if (portalAction === "person-multiple-exact-matches")
    return {
      cause: "Nel gestionale esistono più schede con lo stesso codice fiscale; la nuova regola ne seleziona una automaticamente.",
      steps: [
        "Premi “Riprendi lavorazione”.",
        "Il worker verificherà le schede e ne sceglierà una casualmente.",
        "L’import proseguirà senza creare un nuovo nominativo.",
      ],
      action: "selected-person",
      operation: operation || "Scelta del nominativo esistente",
    };
  if (
    portalAction === "person-field-missing" &&
    details.selectorKey === "personFirstName"
  )
    return {
      cause:
        "Il programma ha confuso la scheda di un nominativo già esistente con la finestra per crearne uno nuovo.",
      steps: [
        "Non devi compilare nuovamente il nominativo.",
        "Lascia aperta la sua scheda nel gestionale.",
        "Premi “Riprova questo passaggio”: la versione aggiornata riconoscerà la scheda e passerà direttamente all’immobile.",
      ],
      action: "portal",
      operation: operation || "Passaggio dal nominativo all’immobile",
    };
  if (
    portalAction.startsWith("phone-") ||
    portalAction.startsWith("person-contact-")
  )
    return {
      cause:
        "Il gestionale non ha completato la verifica o l’assegnazione dei recapiti.",
      steps: [
        "Lascia aperta la scheda del nominativo.",
        "Il programma controllerà di nuovo i recapiti già presenti senza ricreare la persona.",
        "Se il numero appartiene a un’altra scheda, lo sposterà automaticamente quando la corrispondenza è univoca.",
      ],
      action: "portal",
      operation: operation || "Verifica recapiti Excel",
    };
  if (
    portalAction.startsWith("person-property-") ||
    portalAction.startsWith("property-")
  )
    return {
      cause:
        "Il gestionale non ha completato il passaggio relativo all’immobile.",
      steps: [
        "Lascia aperta la scheda attuale.",
        "Premi “Riprova questo passaggio”: il programma riaprirà il nominativo o l’immobile corretto usando l’identificativo salvato.",
        "Se continua a non riuscire, usa “Salta immobile” per proseguire con gli altri.",
      ],
      action: "portal",
      operation: operation || "Ricerca o compilazione immobile",
    };
  if (portalAction.startsWith("activity-"))
    return {
      cause:
        "La finestra dell’attività non ha terminato il caricamento o non ha confermato il salvataggio.",
      steps: [
        "Non creare l’attività dal nominativo: il programma la riaprirà dalla scheda dell’immobile.",
        "Lascia il gestionale aperto e riprova.",
        "Prima di salvare, il programma ricontrollerà immobile collegato, descrizione e stato.",
      ],
      action: "portal",
      operation: operation || "Attività dall’immobile",
    };
  if (
    status === "session_expired" ||
    (text.includes("sessione") && text.includes("scad"))
  )
    return {
      cause: "La sessione del portale non è più valida.",
      steps: [
        "Apri Chrome di lavoro.",
        "Accedi di nuovo al portale indicato, senza chiudere la scheda.",
        "Torna qui e premi “Ho effettuato l’accesso, riprendi”.",
      ],
      action: "session",
    };
  if (
    status === "data_incomplete" ||
    text.includes("mancant") ||
    text.includes("quota")
  )
    return {
      cause:
        "Uno o più dati indispensabili non sono disponibili o non sono leggibili con certezza.",
      steps: [
        "Apri “Correggi dati qui sotto”.",
        "Compila i campi evidenziati usando il dato visibile su SISTER.",
        "Salva e riprendi: il programma continuerà dal passaggio successivo.",
      ],
      action: "data",
    };
  if (
    status === "needs_review" ||
    text.includes("più") ||
    text.includes("merge")
  )
    return {
      cause:
        "Il programma ha trovato più possibilità e non vuole scegliere quella sbagliata.",
      steps: [
        "Controlla nel gestionale quale scheda è corretta.",
        "Se serve, completa il merge o la scelta manualmente.",
        "Premi “Ho risolto nel gestionale, riprendi”.",
      ],
      action: "review",
    };
  if (
    status === "portal_error" &&
    (text.includes("campo") ||
      text.includes("luogo di nascita") ||
      text.includes("sesso"))
  )
    return {
      cause: raw,
      steps: [
        "Lascia aperta la finestra Nominativo così com’è.",
        "Premi “Riprova questo passaggio”: il programma riutilizzerà la finestra già aperta.",
        "Se il gestionale mostra più alternative per il luogo di nascita, scegli quella corretta e riprendi.",
      ],
      action: "portal",
    };
  if (
    text.includes("selector") ||
    text.includes("locator") ||
    text.includes("pagina") ||
    status === "portal_error"
  )
    return {
      cause:
        "La pagina del portale è diversa da quella attesa oppure c’è una finestra aperta che copre i comandi.",
      steps: [
        "Lascia aperta la pagina indicata nel gestionale o in SISTER.",
        "Chiudi eventuali messaggi o finestre rimaste a metà.",
        "Premi “Riprova questo passaggio”. Se manca un valore, puoi inserirlo dall’app.",
      ],
      action: "portal",
    };
  return {
    cause:
      "Si è verificato un problema inatteso, ma l’avanzamento precedente è al sicuro.",
    steps: [
      "Attendi il controllo automatico dei collegamenti nella barra in alto.",
      "Quando i sistemi sono verdi, riprova il passaggio.",
      "Se manca un dato, usa “Correggi dati qui sotto”.",
    ],
    action: "unknown",
  };
}

/* Le tre modalita dell'attivita nel gestionale. La regola vale per tutte le
 * run: lavorazioni, long run, richieste e incarichi. */
const ACTIVITY_MODE_HELP = {
  direct_contact: "Senza recapiti usa “Contatto diretto”, “Eseguito” e una descrizione automatica.",
  plain: "Senza recapiti lascia l’attività generica: “Da eseguire” e “Inserire attività”.",
  none: "Nessuna attività viene creata nel gestionale, per nessun immobile.",
};
function activityMode() {
  const stored = appState?.preferences?.propertyActivityMode;
  return ACTIVITY_MODE_HELP[stored] ? stored : "direct_contact";
}
/* L'eco immediata del clic: lo stato vero torna con la prossima pubblicazione. */
function renderActivityModeOptimistic(mode) {
  if (appState?.preferences) appState.preferences.propertyActivityMode = mode;
  renderActivityMode();
}
function renderActivityMode() {
  const mode = activityMode();
  document.querySelectorAll("[data-activity-mode]").forEach((button) => {
    const selected = button.dataset.activityMode === mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  $("autoFillDirectContactHelp").textContent = ACTIVITY_MODE_HELP[mode];
}
function renderChecks() {
  const wanted = [
    ["chrome", "Chrome"],
    ["sister", "SISTER"],
    ["crm", "Gestionale"],
    ["excel", "File Excel"],
    ["supabase", "Archivio dati"],
  ];
  const rotti = [];
  $("checksGrid").innerHTML = wanted
    .map(([id, label]) => {
      const keep = appState?.sisterKeepAlive,
        browserResult = checks.find((x) => x.id === id),
        keepIsNewer = Date.parse(keep?.checkedAt ?? "") > Date.parse(appState?.connections?.checkedAt ?? "");
      // Un timeout isolato del keep-alive non significa che la scheda sia
      // chiusa: il controllo CDP resta autorevole. Sostituiscilo soltanto con
      // un successo o con una sessione esplicitamente scaduta.
      const keepResult =
        id === "sister" && keepIsNewer && (keep?.ok || keep?.sessionExpired)
          ? {
              ok: keep.ok,
              state: keep.ok ? "ready" : keep.sessionExpired ? "login" : "unreachable",
              detail: keep.ok
                ? `Sessione attiva · ${fmtTime(keep.checkedAt)}`
                : keep.message,
            }
          : null;
      const result = keepResult ?? browserResult;
      if (result && !result.ok) rotti.push({ id, label, state: result.state, detail: result.detail });
      return `<div class="check-item ${result ? (result.ok ? "is-ok" : "is-error") : ""}"><span></span><div><b>${label}</b><small title="${esc(result?.detail ?? "Da controllare")}">${esc(result?.detail ?? "Da controllare")}</small></div></div>`;
    })
    .join("");
  $("chromeButton").classList.toggle("is-hidden", checks.find((check) => check.id === "chrome")?.ok === true);
  renderConnectionState(rotti, checks.length > 0);
}

/**
 * Lo stato dei collegamenti si legge in due posti soltanto: una pastiglia
 * nella barra del titolo, sempre presente, e una barra nella pagina che
 * compare unicamente quando c'e qualcosa da sistemare. La griglia per sistema
 * resta, ma dietro «Dettagli»: serve a chi deve capire quale pezzo manca.
 */
/**
 * L'ultima lavorazione conclusa, accanto alla partenza.
 *
 * Non aggiunge dati: legge la prima voce degli import conclusi, la stessa che
 * la Cronologia mostra per esteso, e riusa il comando che ne apre il
 * riepilogo. Serve a sapere da dove si riparte senza cambiare pagina.
 */
function renderLastRun() {
  const panel = $("lastRunPanel");
  if (!panel) return;
  const ultimo = (appState?.completedImports ?? [])[0];
  const renderKey = ultimo
    ? [
        ultimo.job.id,
        ultimo.job.updated_at ?? ultimo.job.completed_at ?? "",
        ultimo.propertyCount ?? ultimo.properties?.length ?? 0,
        ultimo.peopleCount ?? ultimo.people?.length ?? 0,
      ].join(":")
    : "empty";
  if (renderKey === lastRunRenderKey) return;
  lastRunRenderKey = renderKey;
  if (!ultimo) {
    panel.innerHTML = `<p class="run-last-empty">Nessuna lavorazione conclusa: la prima comparirà qui.</p>`;
    return;
  }
  const job = ultimo.job;
  const luogo = [job.municipality, job.street, job.civic_number].filter(Boolean).join(" · ")
    || `Lavorazione ${job.id.slice(0, 8)}`;
  panel.innerHTML = `
    <div class="run-last-head">
      <span class="run-last-label">Ultima lavorazione</span>
      <span class="run-last-outcome">completata</span>
    </div>
    <b class="run-last-place">${esc(luogo)}</b>
    <span class="run-last-when">${esc(fmtDate(job.completed_at ?? job.updated_at))}</span>
    <dl class="run-last-figures">
      <div><dt>Immobili</dt><dd>${fmtCount(ultimo.propertyCount ?? ultimo.properties?.length ?? 0)}</dd></div>
      <div><dt>Nominativi</dt><dd>${fmtCount(ultimo.peopleCount ?? ultimo.people?.length ?? 0)}</dd></div>
    </dl>
    <button class="text-button run-last-open" data-detail-job="${esc(job.id)}">Apri il riepilogo</button>`;
}
function renderConnectionState(rotti, controllato) {
  const pill = $("connectionPill");
  const alert = $("connectionAlert");
  if (!pill || !alert) return;

  pill.classList.toggle("is-ok", controllato && rotti.length === 0);
  pill.classList.toggle("is-error", rotti.length > 0);
  $("connectionPillLabel").textContent = !controllato
    ? "Controllo in corso"
    : rotti.length === 0
      ? "Tutti i collegamenti pronti"
      : rotti.length === 1
        ? "1 collegamento da sistemare"
        : `${rotti.length} collegamenti da sistemare`;

  alert.classList.toggle("is-hidden", rotti.length === 0);
  if (!rotti.length) return;
  const login = rotti.filter((item) => item.state === "login").map((item) => item.label),
    missing = rotti.filter((item) => item.state === "missing").map((item) => item.label),
    unreachable = rotti.filter((item) => item.state === "unreachable").map((item) => item.label),
    databaseConfiguration = rotti.some((item) => item.id === "supabase" && item.state === "configuration");
  $("configurationButton").classList.toggle("is-hidden", !databaseConfiguration);
  $("connectionAlertTitle").textContent = databaseConfiguration
    ? "Aggiorna il collegamento al nuovo archivio dati."
    : login.length
    ? `Completa l’accesso in ${login.join(" e ")}.`
    : missing.length
      ? `Apri ${missing.join(" e ")} in Chrome.`
      : unreachable.includes("Chrome")
        ? "Chrome di lavoro non è raggiungibile."
        : `Controlla ${rotti.map((item) => item.label).join(" e ")}.`;
}
function currentPhase(step) {
  if (step === "ready") return 0;
  if (
    [
      "sister_results_acquired",
      "properties_extracted",
      "owners_extracted",
      "data_normalized",
    ].includes(step)
  )
    return 1;
  if (step === "acquisition_reviewed") return 2;
  if (
    step === "properties_processed" ||
    [
      "person_searched",
      "person_created_or_updated",
      "person_merge_reviewed",
      "property_searched",
      "property_created_or_updated",
      "activity_created",
      "contacts_matched",
      "owners_linked",
    ].includes(step)
  )
    return 3;
  return 4;
}
function nextStepName(last) {
  const index = STEPS.indexOf(last);
  return index < 0
    ? "properties_processed"
    : STEPS[Math.min(index + 1, STEPS.length - 1)];
}
function renderSteps() {
  const completion = appState?.operationCompletion;
  if (completion) {
    $("operationTitle").textContent = completion.title;
    $("progressPercent").textContent = "100%";
    $("progressBar").style.width = "100%";
    $("workflowSteps").innerHTML = `<li class="workflow-step is-done"><span class="index">✓</span><b>Operazione conclusa<small>${esc(completion.summary)}</small></b></li>`;
    return;
  }
  const nonPropertyRun = appState?.streetRun?.active || appState?.networkRun?.active || appState?.requestArchive?.active || appState?.mandateArchive?.active;
  if (nonPropertyRun) {
    const operation = currentOperation();
    const percent = Math.max(0, Math.min(100, Number(operation?.percent ?? 0)));
    const definitions = appState?.streetRun?.active
      ? [
          ["Preparo la via", "Verifico pagina e varianti esatte"],
          ["Leggo gli immobili", "Raccolgo righe e dati catastali"],
          ["Leggo i proprietari", "Estraggo nominativi, quote e codici fiscali"],
          ["Salvo e importo", "Conservo la coda e avvio il cloud se previsto"],
        ]
      : appState?.networkRun?.active
        ? [
            ["Scelgo i nominativi", "Parto dai codici fiscali verificati"],
            ["Esploro le proprietà", "Attraverso soci e comproprietari"],
            ["Applico le barriere", "Scarto esistenti e immobili non strategici"],
            ["Consolido la coda", "Salvo soltanto candidati verificati"],
          ]
        : [
            ["Apro la ricerca", "Raggiungo automaticamente la pagina corretta"],
            ["Indicizzo le righe", "Raccolgo tutti gli elementi disponibili"],
            ["Sincronizzo i dettagli", "Aggiorno un record alla volta"],
            ["Chiudo il ciclo", "Salvo esito e record da riprovare"],
          ];
    const currentIndex = Math.min(definitions.length - 1, Math.floor(percent / 25));
    $("operationTitle").textContent = operation?.title ?? "Operazione in corso";
    $("progressPercent").textContent = `${Math.round(percent)}%`;
    $("progressBar").style.width = `${percent}%`;
    $("workflowSteps").innerHTML = definitions.map(([label, detail], index) =>
      `<li class="workflow-step ${index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}"><span class="index">${index < currentIndex ? "✓" : index + 1}</span><b>${esc(label)}<small>${esc(detail)}</small></b></li>`,
    ).join("");
    return;
  }
  const job = appState?.jobs?.find((j) => j.id === appState.activeJobId);
  const current = appState?.currentStep ?? job?.current_step ?? "ready",
    phase = currentPhase(current),
    done = current === "completed";
  let percent = [0, 15, 40, 50, 95][phase] ?? 0;
  const p = appState?.propertyProgress;
  if (current === "properties_processed" && p?.total)
    percent = Math.round(
      50 + ((p.index - 1 + (p.stage === "completed" ? 1 : 0)) / p.total) * 40,
    );
  if (done) percent = 100;
  $("progressPercent").textContent = `${percent}%`;
  $("progressBar").style.width = `${percent}%`;
  $("workflowSteps").innerHTML = PHASES.map(
    (item, i) =>
      `<li class="workflow-step ${done || i < phase ? "is-done" : i === phase ? "is-current" : ""}"><span class="index">${done || i < phase ? "✓" : i + 1}</span><b>${esc(item.label)}<small>${esc(item.detail)}</small></b></li>`,
  ).join("");
}
function cancelButton(jobId) {
  return jobId
    ? `<button class="button danger" data-cancel-job="${esc(jobId)}">Annulla lavoro</button>`
    : "";
}
function promptButtons(prompt) {
  if (prompt.kind === "merge")
    return `<button class="button primary" data-prompt="confirm">Il merge è corretto</button><button class="button secondary" data-prompt="manual">Lo sistemo manualmente</button>`;
  if (prompt.kind === "decision")
    return `<button class="button primary" data-prompt="confirm">Conferma</button><button class="button secondary" data-prompt="skip">Salta questo caso</button><button class="button secondary" data-prompt="manual">Modifico nel gestionale</button><button class="button danger" data-prompt="review">Segna da verificare</button>`;
  return `<button class="button primary" data-prompt="confirm">${prompt.kind === "acquisition" ? "Acquisisci risultati" : "Ho terminato, continua"}</button>`;
}
function activeBackgroundOperation() {
  return appState?.streetRun?.active
    ? { label: "Long run via", title: "Acquisizione della via in corso", detail: "Leggo varianti, immobili e proprietari. L’avanzamento viene salvato continuamente.", action: "pause-street-run", actionLabel: "Metti in pausa" }
    : appState?.networkRun?.active
      ? { label: "Rete proprietari", title: "Lavorazione delle vie in corso", detail: "Procedo dal centro verso l’esterno e completo ogni import CRM prima di passare alla via successiva.", action: "pause-network-run", actionLabel: "Pausa dopo questa via" }
      : appState?.requestArchive?.active
        ? { label: "Sincronizzazione", title: "Sto sincronizzando le richieste", detail: "La pagina necessaria viene aperta automaticamente. I risultati già completati restano salvati.", action: "cancel-request-sync", actionLabel: "Interrompi" }
        : appState?.mandateArchive?.active
          ? { label: "Sincronizzazione", title: "Sto sincronizzando gli incarichi", detail: "La pagina necessaria viene aperta automaticamente. I risultati già completati restano salvati.", action: "cancel-mandate-sync", actionLabel: "Interrompi" }
          : null;
}
function hasActiveBackgroundOperation() {
  return Boolean(activeBackgroundOperation());
}
function hasVisibleForegroundError() {
  return Boolean(appState?.lastError && !hasActiveBackgroundOperation());
}
function renderAction() {
  const panel = $("actionPanel"),
    job = currentJob(),
    completed =
      job?.status === "completed" || appState?.currentStep === "completed";
  if (appState?.configError) {
    panel.className = "now-card is-error";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Configurazione necessaria</div><h2>Completa una sola volta le impostazioni</h2><p>Il programma non ha trovato la configurazione interna. Non serve creare un file: inserisci i valori nella sezione avanzata e Windows li proteggerà.</p><div class="now-actions"><button class="button primary" data-action="config">Apri impostazioni</button></div></div><div class="now-side"><h3>Cosa manca</h3><p>${esc(appState.configError)}</p></div></div>`;
    return;
  }
  if (appState?.cloudError) {
    panel.className = "now-card is-warning";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Cloud temporaneamente limitato</div><h2>Le operazioni cloud restano ferme in sicurezza</h2><p>Il worker non avvia operazioni cloud che potrebbero lasciare dati incompleti nel gestionale. I dry-run locali e il controllo e download degli aggiornamenti restano disponibili perché non usano Supabase.</p></div><div class="now-side"><h3>Dettaglio</h3><p>${esc(appState.cloudError)}</p></div></div>`;
    return;
  }
  if (appState?.cancellingJobId) {
    panel.className = "now-card is-warning";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Arresto sicuro</div><h2>Sto annullando la lavorazione</h2><p>Attendo la fine dell’operazione già iniziata, poi elimino i dati del lavoro.</p></div><div class="now-side"><b>Non chiudere l’app.</b><p>Ti avviserò appena l’annullamento è concluso.</p></div></div>`;
    return;
  }
  if (appState?.prompt) {
    if (appState.prompt.kind === "acquisition-review") {
      panel.className = "now-card";
      panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Dati raccolti</div><h2>Controlla immobili e proprietari</h2><p>La raccolta da SISTER è finita. Prima di toccare il gestionale, verifica il riepilogo.</p><div class="now-actions"><button class="button primary" data-action="open-review">Apri il riepilogo</button>${cancelButton(appState.activeJobId)}</div></div><div class="now-side"><h3>Dopo la conferma</h3><p>Inizierò a cercare i nominativi nel gestionale.</p></div></div>`;
      return;
    }
    panel.className = "now-card is-warning";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Serve una tua conferma</div><h2>${esc(appState.prompt.title)}</h2><p>${esc(appState.prompt.summary)}</p><div class="now-actions">${promptButtons(appState.prompt)}${cancelButton(appState.activeJobId)}</div></div><div class="now-side"><h3>Perché mi sono fermato?</h3><p>Questa scelta può modificare dati nel gestionale. Attendo la tua decisione per sicurezza.</p></div></div>`;
    return;
  }
  const backgroundRun = activeBackgroundOperation();
  if (backgroundRun) {
    panel.className = "now-card";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>${esc(backgroundRun.label)}</div><h2>${esc(backgroundRun.title)}</h2><p>${esc(backgroundRun.detail)}</p><div class="now-actions"><button class="button secondary" data-action="${backgroundRun.action}">${backgroundRun.actionLabel}</button></div></div><div class="now-side"><h3>Nessuna finestra da gestire</h3><p>Tutto l'avanzamento e tutti i controlli sono raccolti in questa plancia. Se serve una decisione, comparirà qui.</p></div></div>`;
    return;
  }
  const completion = appState?.operationCompletion;
  if (completion) {
    const stats = Array.isArray(completion.stats) ? completion.stats : [];
    panel.className = "now-card is-success";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span>✓</span>Operazione completata</div><h2>${esc(completion.title)}</h2><p>${esc(completion.summary)}</p>${stats.length ? `<div class="success-summary">${stats.map((stat) => `<b>${fmtCount(stat.value)} ${esc(stat.label.toLowerCase())}</b>`).join("")}</div>` : ""}</div><div class="now-side"><h3>Tutto concluso con successo</h3><p>Conclusa il ${esc(fmtDate(completion.completedAt))}. Puoi avviare una nuova operazione: questa schermata verrà sostituita automaticamente.</p></div></div>`;
    return;
  }
  if (completed) {
    const properties = job?.processed_properties ?? job?.total_properties ?? 0,
      people = job?.processed_people ?? job?.total_people ?? 0;
    panel.className = "now-card is-success";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span>✓</span>Import concluso</div><h2>Import eseguito con successo</h2><p>Il gestionale è stato aggiornato e tutti i passaggi risultano completati.</p><div class="success-summary"><b>${properties} immobili completati</b><b>${people} nominativi elaborati</b></div><div class="now-actions"><button class="button primary" data-scroll="completedImports">Vedi cosa è stato importato</button></div></div><div class="now-side"><h3>Nessuna azione richiesta</h3><p>Il lavoro è memorizzato nella sezione “Import effettuati con successo”. Puoi iniziare una nuova lavorazione.</p></div></div>`;
    return;
  }
  if (hasVisibleForegroundError()) {
    const advice = errorAdvice(job, appState.lastError),
      last = guide(job?.last_completed_step),
      next = guide(nextStepName(job?.last_completed_step)),
      property = job?.error_details?.propertyAddress,
      operation = advice.operation ?? job?.error_details?.operationLabel,
      reanalyzePropertyId = typeof job?.error_details?.propertyId === "string" ? job.error_details.propertyId : null;
    panel.className = "now-card is-error";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>Lavorazione ferma, dati salvati</div><h2>${esc(advice.cause)}</h2>${operation ? `<p><b>Cosa stavo facendo:</b> ${esc(operation)}${property ? ` su ${esc(property)}` : ""}.</p>` : ""}<p>Ultimo punto concluso: <b>${esc(last.label)}</b>. Ripartirò da <b>${esc(next.label)}</b>, senza ricominciare.</p><div class="recovery-box"><b>Cosa fare adesso</b><ol>${advice.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div><div class="now-actions">${advice.action === "data" || advice.action === "unknown" ? `<button class="button primary" data-action="open-corrections">Correggi dati qui sotto</button>` : ""}<button class="button ${advice.action === "data" ? "secondary" : "primary"}" data-action="resume-current">${advice.action === "session" ? "Ho effettuato l’accesso, riprendi" : advice.action === "review" ? "Ho risolto nel gestionale, riprendi" : advice.action === "selected-person" ? "Ho scelto la scheda corretta, continua" : "Riprova questo passaggio"}</button><button class="button secondary" data-action="checks">Controlla collegamenti</button>${cancelButton(appState.activeJobId)}</div><details class="technical-details"><summary>Dettaglio tecnico per assistenza</summary><pre>${esc(appState.lastError)}</pre></details></div><div class="now-side"><h3>Il lavoro è al sicuro</h3><p>Ogni passaggio concluso è stato salvato. La ripresa riapre le schede tramite i loro identificativi e non ricrea ciò che è già completo.</p></div></div>`;
    if (reanalyzePropertyId) {
      panel.querySelector(".now-actions")?.insertAdjacentHTML(
        "beforeend",
        `<button class="button secondary" data-action="reanalyze-current" data-property-id="${esc(reanalyzePropertyId)}">Rianalizza situazione</button>`,
      );
      panel.querySelector(".now-side p").textContent = "Rianalizza situazione riparte da questo immobile, conserva ciò che il Cloud ha già e aggiunge soltanto gli elementi mancanti.";
    }
    return;
  }
  const current = guide(appState?.currentStep ?? "ready");
  if (appState?.active) {
    const progress = appState.propertyProgress,
      isAcquisition = appState.currentStep === "owners_extracted",
      pausePending = appState.pausingJobId === appState.activeJobId,
      propertyContext = progress
        ? `<span class="property-position">${isAcquisition ? "Riga" : "Immobile"} ${progress.index} di ${progress.total}</span><h2>${esc(progress.address ?? "Immobile senza indirizzo")}</h2><p><b>${esc(progress.message)}</b></p>`
        : `<h2>${esc(current.label)}</h2><p>${esc(current.doing)}</p>`;
    panel.className = pausePending ? "now-card is-warning" : "now-card";
    panel.innerHTML = `<div class="now-grid"><div class="now-main"><div class="now-label"><span></span>${pausePending ? "Pausa acquisita" : "Sto lavorando adesso"}</div>${propertyContext}<div class="now-actions"><button class="button secondary" data-action="pause" ${pausePending ? "disabled" : ""}>${pausePending ? "Arresto al punto sicuro…" : "Metti in pausa"}</button>${cancelButton(appState.activeJobId)}</div></div><div class="now-side"><h3>${progress ? (isAcquisition ? "Paracadute acquisizione" : "Ordine per questo immobile") : "Cosa succede dopo"}</h3>${pausePending ? "<p>La richiesta è stata ricevuta. Concludo soltanto l’azione atomica già iniziata, senza lasciare un salvataggio a metà.</p>" : progress ? (isAcquisition ? "<p>Ogni riga è isolata. Puoi saltare quella corrente senza perdere le precedenti né fermare le successive.</p>" : "<ol><li>Recapiti di tutti i proprietari</li><li>Anagrafiche verificate</li><li>Immobile collegato</li><li>Attività dall’immobile</li><li>Comproprietari e quote</li></ol>") : `<p>${esc(current.next)}</p>`}<p><b>Non devi fare nulla</b> finché non compare una richiesta.</p></div></div>`;
    return;
  }
  panel.className = "now-card is-hidden";
  panel.innerHTML = "";
}

/* Da dove viene una raccolta e con quali limiti: senza questa riga tre
 * acquisizioni conservate si distinguono solo per la data. */
const ACQUISIZIONE_TIPO = { network: "Rete proprietari", street: "Via completa", civic: "Civico" };
const ATTIVITA_ETICHETTA = { direct_contact: "attività autocompilata", plain: "attività generica", none: "nessuna attività" };

function riassuntoAcquisizione(acquisition) {
  if (!acquisition || typeof acquisition !== "object") return "";
  const pezzi = [];
  if (acquisition.kind === "network") {
    const s = acquisition.settings ?? {};
    if (s.targetProperties != null) pezzi.push(`obiettivo ${fmtCount(s.targetProperties)}`);
    if (s.maxDepth != null) pezzi.push(`profondità ${fmtCount(s.maxDepth)}`);
    if (s.maxPeople != null) pezzi.push(`${fmtCount(s.maxPeople)} persone`);
    if (s.seedCount != null) pezzi.push(`${fmtCount(s.seedCount)} clienti`);
    if (s.residentialOnly) pezzi.push("solo abitazioni");
    if (acquisition.peopleVisited != null) pezzi.push(`${fmtCount(acquisition.peopleVisited)} visitate`);
    const scartati = Object.values(acquisition.skipped ?? {}).reduce((somma, valore) => somma + Number(valore || 0), 0);
    if (scartati) pezzi.push(`${fmtCount(scartati)} scartati`);
  } else if (acquisition.workerMode) {
    pezzi.push(acquisition.workerMode === "automatic" ? "automatica" : "guidata");
  }
  const attivita = ATTIVITA_ETICHETTA[acquisition.activityMode];
  if (attivita) pezzi.push(attivita);

  return pezzi.join(" · ");
}

function renderJobs() {
  const jobs = appState?.jobs ?? [];
  const conservate = jobs.filter((job) => job.status === "saved" && !job.import_started_at).length;
  $("jobCount").textContent = String(conservate);
  updateHistoryNavHint();
  const renderKey = [
    appState?.active ? "active" : "idle",
    ...jobs.map((job) => [
      job.id,
      job.updated_at ?? job.saved_at ?? job.created_at ?? "",
      job.status,
      job.import_started_at ?? "",
      job.acquisition ? "p" : "",
    ].join(":")),
  ].join("|");
  if (renderKey === jobsRenderKey) return;
  jobsRenderKey = renderKey;
  $("jobsList").innerHTML = jobs.length
    ? jobs
        .map((job) => {
          const canImport = !appState.active && job.status !== "completed",
            tipo = ACQUISIZIONE_TIPO[job.acquisition?.kind] ?? null,
            luogo =
              [job.municipality, job.street, job.civic_number]
                .filter(Boolean)
                .join(" · "),
            place = luogo || tipo || `Ricerca ${job.id.slice(0, 8)}`,
            fattori = riassuntoAcquisizione(job.acquisition),
            imported = job.status === "completed",
            inProgress = Boolean(job.import_started_at) && !imported;
          return `<article class="ledger-row job-item ${imported ? "is-completed" : inProgress ? "is-running" : ""}"><span class="ledger-mark"></span><span class="ledger-place"><b>${esc(place)}</b><small>${esc([tipo && luogo ? tipo : null, fmtDate(job.saved_at ?? job.created_at), fattori].filter(Boolean).join(" · "))}</small></span><span class="ledger-figure">${fmtCount(job.total_properties ?? 0)}</span><span class="ledger-figure">${fmtCount(job.total_people ?? 0)}</span><span class="ledger-state">${imported ? "Importazione completata" : inProgress ? `Iniziata · ${esc(guide(job.last_completed_step ?? "acquisition_reviewed").label)}` : "Pronta per l'import"}</span><span class="ledger-actions"><button class="text-button" data-detail-job="${job.id}">Apri dati</button>${canImport ? `<button class="text-button" data-resume-job="${job.id}">${inProgress ? "Continua" : "Importa"}</button>` : ""}<button class="text-button is-destructive" data-cancel-job="${job.id}">Elimina</button></span></article>`;
        })
        .join("")
    : `<p class="empty-message">Nessuna ricerca salvata. Dopo la lettura SISTER potrai conservarla qui e importarla quando vuoi.</p>`;
}
function markImportActivity() {
  for (const scelta of document.querySelectorAll("#importActivityChoices [data-import-activity]")) {
    const attiva = scelta.dataset.importActivity === importActivityMode;
    scelta.classList.toggle("is-selected", attiva);
    scelta.setAttribute("aria-checked", String(attiva));
  }
}

async function openImportDialog(jobId) {
  const job = (appState?.jobs ?? []).find((riga) => riga.id === jobId);
  importJobId = jobId;
  /* Il modo con cui i dati sono stati raccolti e' il default: se allora le
   * attivita' erano autocompilate, importarle mute sarebbe una sorpresa. */
  importActivityMode = job?.acquisition?.activityMode
    ?? appState?.preferences?.propertyActivityMode
    ?? "direct_contact";
  markImportActivity();

  const luogo = [job?.municipality, job?.street, job?.civic_number].filter(Boolean).join(" · ");
  const tipo = ACQUISIZIONE_TIPO[job?.acquisition?.kind] ?? null;
  $("importDialogTitle").textContent = luogo || tipo || "Acquisizione conservata";
  const fattori = riassuntoAcquisizione(job?.acquisition);
  $("importDialogMeta").textContent = [
    tipo && luogo ? tipo : null,
    job?.saved_at ? `raccolta il ${fmtDate(job.saved_at)}` : null,
    fattori,
  ].filter(Boolean).join(" · ");
  $("importDialogContent").innerHTML = `<p class="empty-message">Rileggo i dati…</p>`;
  $("importDialog").showModal();

  const detail = await window.propertyWorker.getJobDetails(jobId);
  if (importJobId !== jobId) return;
  const { peopleById, ownershipsByPropertyId } = relationshipIndex(detail.people, detail.ownerships);
  $("importDialogContent").innerHTML = `<p class="review-count"><b>${fmtCount(detail.properties.length)}</b> immobili · <b>${fmtCount(detail.people.length)}</b> proprietari · <b>${fmtCount(detail.ownerships.length)}</b> quote</p>${detail.properties
    .map((immobile) => {
      const quote = ownershipsByPropertyId.get(immobile.id) ?? [];
      const nomi = quote
        .map((quota) => peopleById.get(quota.person_id))
        .filter(Boolean)
        .map((persona) => esc(persona.full_name ?? "Senza nome"))
        .join(", ");
      return `<div class="detail-group"><b>${esc(immobile.address ?? immobile.cadastral_key)}</b><small>${esc(immobile.cadastral_key)}${nomi ? ` · ${nomi}` : " · nessun proprietario collegato"}</small></div>`;
    })
    .join("")}`;
}

function relationshipIndex(people = [], ownerships = []) {
  const peopleById = new Map(people.map((person) => [person.id, person])),
    ownershipsByPropertyId = new Map();
  for (const ownership of ownerships) {
    const current = ownershipsByPropertyId.get(ownership.property_id);
    if (current) current.push(ownership);
    else ownershipsByPropertyId.set(ownership.property_id, [ownership]);
  }
  return { peopleById, ownershipsByPropertyId };
}
function renderCompletedImports() {
  const imports = appState?.completedImports ?? [];
  $("completedImportCount").textContent = imports.length;
  updateHistoryNavHint();
  const renderKey = imports
    .map((item) => [
      item.job.id,
      item.job.updated_at ?? item.job.completed_at ?? "",
      item.properties.length,
      item.people.length,
      item.ownerships.length,
    ].join(":"))
    .join("|");
  if (renderKey === completedImportsRenderKey) return;
  completedImportsRenderKey = renderKey;
  $("completedImportsList").innerHTML = imports.length
    ? imports
        .map((item) => {
          const job = item.job,
            { peopleById, ownershipsByPropertyId } = relationshipIndex(item.people, item.ownerships),
            place =
              [job.municipality, job.street, job.civic_number]
                .filter(Boolean)
                .join(" · ") || `Import ${job.id.slice(0, 8)}`;
          return `<section class="completed-import"><header><div><span class="completed-check">✓</span><div><h3>${esc(place)}</h3><p>Concluso ${fmtDate(job.completed_at ?? job.updated_at)} · ${item.properties.length} immobili · ${item.people.length} nominativi</p></div></div><button class="text-button" data-detail-job="${job.id}">Apri riepilogo</button></header><div class="completed-property-list">${item.properties
            .map((property, index) => {
              const related = (ownershipsByPropertyId.get(property.id) ?? [])
                .map((owner) => ({
                  owner,
                  person: peopleById.get(owner.person_id),
                }))
                .filter((entry) => entry.person);
              const activity = property.raw_payload?.worker_activity?.state;
              return `<article class="completed-property-card"><div class="completed-owners"><p class="eyebrow">Nominativi · ${related.length}</p>${related.map(({ owner, person }) => `<div class="completed-owner"><div><strong>${esc(person.full_name)}</strong><span>${owner.share_percentage == null ? "Quota non disponibile" : `${new Intl.NumberFormat("it-IT").format(owner.share_percentage)}%`}</span></div><small>${esc(person.tax_code ?? "Codice fiscale non disponibile")}</small><small>${esc([person.birth_place, person.birth_date].filter(Boolean).join(" · ") || "Dati di nascita non disponibili")}</small><small>${esc([...(person.mobiles ?? []), ...(person.landlines ?? []), ...(person.emails ?? [])].join(" · ") || "Nessun recapito trovato")}</small></div>`).join("") || `<p class="empty-message">Nessun nominativo collegato.</p>`}</div><div class="completed-property-data"><div class="completed-property-heading"><p class="eyebrow">Immobile ${index + 1}</p><span class="completion-label">Completato</span></div><h3>${esc(property.address ?? "Indirizzo non disponibile")}</h3><p class="cadastral-key">${esc(property.cadastral_key)}</p><dl><div><dt>Categoria</dt><dd>${esc(property.category ?? "—")}</dd></div><div><dt>Consistenza</dt><dd>${esc(property.consistency ?? "—")}</dd></div><div><dt>Rendita</dt><dd>${property.cadastral_income == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(property.cadastral_income)}</dd></div><div><dt>Attività</dt><dd>${activity === "created" ? "Creata" : activity === "existing" ? "Già presente" : "Verificata"}</dd></div></dl></div></article>`;
            })
            .join("")}</div></section>`;
        })
        .join("")
    : `<div class="completed-empty"><span>✓</span><div><b>Nessun import concluso</b><p>Quando una lavorazione termina correttamente, troverai qui immobili, nominativi e quote.</p></div></div>`;
}
function isSkippedProperty(property) {
  return (
    ["skipped", "acquisition_skipped", "acquisition_failed"].includes(
      property?.processing_status,
    ) || property?.raw_payload?.property_flow?.stage === "skipped"
  );
}
function completedSessionStats(item) {
  if (
    Number.isFinite(item?.completedProperties) &&
    Number.isFinite(item?.skippedProperties) &&
    Number.isFinite(item?.skippedPeople)
  ) {
    return {
      completedProperties: item.completedProperties,
      skippedProperties: item.skippedProperties,
      skippedPeople: item.skippedPeople,
    };
  }
  const skippedProperties = (item.properties ?? []).filter(isSkippedProperty),
    skippedIds = new Set(skippedProperties.map((property) => property.id)),
    skippedPeople = new Set(
      (item.ownerships ?? [])
        .filter((owner) => skippedIds.has(owner.property_id))
        .map((owner) => owner.person_id),
    );
  return {
    completedProperties:
      (item.properties ?? []).length - skippedProperties.length,
    skippedProperties: skippedProperties.length,
    skippedPeople: skippedPeople.size,
  };
}
function renderCompletedSessions() {
  const imports = appState?.completedImports ?? [];
  $("completedImportCount").textContent = imports.length;
  updateHistoryNavHint();
  const renderKey = [
    appState?.completedImportsHasMore ? "more" : "end",
    ...imports.map((item) => [
      item.job.id,
      item.job.updated_at ?? item.job.completed_at ?? "",
      item.propertyCount ?? item.properties?.length ?? 0,
      item.peopleCount ?? item.people?.length ?? 0,
      item.skippedProperties ?? "",
      item.skippedPeople ?? "",
    ].join(":")),
  ].join("|");
  if (renderKey === completedImportsRenderKey) {
    enhanceActionPanel();
    return;
  }
  completedImportsRenderKey = renderKey;
  $("completedImportsList").innerHTML = imports.length
    ? imports
        .map((item) => {
          const job = item.job,
            place =
              [job.municipality, job.street, job.civic_number]
                .filter(Boolean)
                .join(" · ") || `Import ${job.id.slice(0, 8)}`,
            stats = completedSessionStats(item),
            peopleCount = item.peopleCount ?? item.people?.length ?? 0,
            skipText = stats.skippedProperties
              ? ` · ${stats.skippedProperties} immobili e ${stats.skippedPeople} nominativi saltati`
              : "";
          return `<article class="ledger-row completed-session ${stats.skippedProperties ? "has-skipped" : ""}"><span class="ledger-mark">${stats.skippedProperties ? "!" : "✓"}</span><span class="ledger-place"><b>${esc(place)}</b><small>${esc(fmtDate(job.completed_at ?? job.updated_at))}</small></span><span class="ledger-figure">${fmtCount(stats.completedProperties)}</span><span class="ledger-figure">${fmtCount(peopleCount)}</span><span class="ledger-state">${stats.skippedProperties ? `${fmtCount(stats.skippedProperties)} immobili e ${fmtCount(stats.skippedPeople)} nominativi saltati` : "Conclusa senza salti"}</span><span class="ledger-actions"><button class="text-button" data-completed-session="${job.id}">Apri sessione</button></span></article>`;
        })
        .join("")
    : `<div class="completed-empty"><span>✓</span><div><b>Nessun import concluso</b><p>Le sessioni completate compariranno qui.</p></div></div>`;
  const more = $("completedImportsLoadMore");
  more.classList.toggle("is-hidden", !appState?.completedImportsHasMore);
  enhanceActionPanel();
}
function completedPropertyCards(detail) {
  const { peopleById, ownershipsByPropertyId } = relationshipIndex(detail.people, detail.ownerships);
  const duplicateContacts = (detail.people ?? []).filter((person) => {
    const duplicates = person.raw_payload?.contacts_flow?.duplicatePhoneAssignments
      ?? person.raw_payload?.contact_assignments_detected
      ?? [];
    return Array.isArray(duplicates) && duplicates.length;
  });
  const duplicateNote = duplicateContacts.length
    ? `<div class="skip-summary"><b>Nota recapiti</b><p>${duplicateContacts.length} nominativo/i hanno numeri già presenti su altre schede: sono stati mantenuti anche qui come da Excel.</p></div>`
    : "";
  return `${duplicateNote}${(detail.properties ?? [])
    .map((property, index) => {
      const related = (ownershipsByPropertyId.get(property.id) ?? [])
          .map((owner) => ({
            owner,
            person: peopleById.get(owner.person_id),
          }))
          .filter((entry) => entry.person),
        activity = property.raw_payload?.worker_activity?.state,
        skipped = isSkippedProperty(property),
        skip = property.raw_payload?.skip_details ?? {},
        attempts = Number(skip.attempts ?? 0),
        automatic = skip.source === "automatic",
        statusLabel = skipped
          ? automatic
            ? `Saltato dopo ${attempts} tentativi`
            : "Saltato manualmente"
          : "Completato",
        reason = String(skip.reason ?? "Caso non completato");
      return `<article class="completed-property-card ${skipped ? "is-skipped" : ""}"><div class="completed-owners"><p class="eyebrow">${skipped ? "Nominativi saltati" : "Nominativi"} · ${related.length}</p>${related.map(({ owner, person }) => `<div class="completed-owner"><div><strong>${esc(person.full_name)}</strong><span>${owner.share_percentage == null ? "Quota non disponibile" : `${new Intl.NumberFormat("it-IT").format(owner.share_percentage)}%`}</span></div><small>${esc(person.tax_code ?? "Codice fiscale non disponibile")}</small><small>${esc([...(person.mobiles ?? []), ...(person.landlines ?? []), ...(person.emails ?? [])].join(" · ") || "Nessun recapito trovato")}</small>${skipped ? `<small class="skipped-person-note">Non completato in questa importazione</small>` : ""}</div>`).join("") || `<p class="empty-message">Nessun nominativo collegato.</p>`}</div><div class="completed-property-data"><div class="completed-property-heading"><p class="eyebrow">Immobile ${index + 1}</p><span class="completion-label ${skipped ? "is-skipped" : ""}">${esc(statusLabel)}</span></div><h3>${esc(property.address ?? "Indirizzo non disponibile")}</h3><p class="cadastral-key">${esc(property.cadastral_key)}</p>${skipped ? `<div class="skip-summary"><b>Perché è stato saltato</b><p>${esc(reason)}</p>${automatic ? `<small>Tre tentativi automatici eseguiti in circa 180 secondi.</small>` : ""}</div>` : ""}<dl><div><dt>Sezione urbana</dt><dd>BA</dd></div><div><dt>Foglio</dt><dd>${esc(property.sheet)}</dd></div><div><dt>Particella</dt><dd>${esc(property.parcel)}</dd></div><div><dt>Subalterno</dt><dd>${esc(property.subaltern)}</dd></div><div><dt>Categoria</dt><dd>${esc(property.category ?? "—")}</dd></div><div><dt>Rendita</dt><dd>${property.cadastral_income == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(property.cadastral_income)}</dd></div><div><dt>Attività</dt><dd>${skipped ? "Non completata" : activity === "created" ? "Creata" : activity === "existing" ? "Già presente" : "Verificata"}</dd></div></dl></div></article>`;
    })
    .join("")}`;
}
function enhanceActionPanel() {
  const actions = $("actionPanel")?.querySelector(".now-actions");
  if (!actions) return;
  const progress = appState?.propertyProgress,
    jobId = appState?.activeJobId,
    isAcquisition = appState?.currentStep === "owners_extracted",
    skipPending =
      progress && appState?.skippingPropertyId === progress.propertyId;
  if (progress && jobId && !actions.querySelector("[data-skip-property]"))
    actions.insertAdjacentHTML(
      "beforeend",
      `<button class="button danger" data-skip-property="${esc(progress.propertyId)}" data-job-id="${esc(jobId)}" ${skipPending ? "disabled" : ""}>${skipPending ? "Skip acquisito…" : isAcquisition ? "Salta riga corrente" : "Salta immobile"}</button>`,
    );
  const side = $("actionPanel")?.querySelector(".now-side");
  if (
    appState?.active &&
    progress &&
    !isAcquisition &&
    side &&
    !side.querySelector(".automation-plan")
  )
    side.insertAdjacentHTML(
      "beforeend",
      `<div class="automation-plan"><b>Controlli automatici inclusi</b><p>Verifico e, se necessario, sposto i recapiti dal vecchio nominativo a quello corretto. Compilo anche sezione urbana BA, foglio, particella, subalterno e rendita.</p></div>`,
    );
  if (
    hasVisibleForegroundError() &&
    !actions.querySelector('[data-action="toggle-auto-retry"]')
  )
    actions.insertAdjacentHTML(
      "beforeend",
      `<button class="button secondary" data-action="toggle-auto-retry">${appState.autoRetryEnabled === false ? "Riattiva riprova automatico" : "Ferma riprova automatico"}</button>`,
    );
  if (hasVisibleForegroundError() && !$("#autoRetryCountdown")) {
    const details = $("actionPanel").querySelector(".technical-details");
    const notice = document.createElement("p");
    notice.id = "autoRetryCountdown";
    notice.className = "auto-retry-notice";
    (details ?? actions).insertAdjacentElement(
      details ? "beforebegin" : "afterend",
      notice,
    );
    updateAutoRetryCountdown();
  }
}
function updateAutoRetryCountdown() {
  const el = $("autoRetryCountdown");
  if (!el) return;
  if (appState?.autoRetryEnabled === false) {
    el.textContent =
      "Riprova automatico fermato. Il lavoro ripartirà soltanto quando premi tu “Riprova questo passaggio” oppure lo riattivi.";
    return;
  }
  const due = appState?.autoRetry?.dueAt;
  if (!due) {
    el.textContent =
      "Riprova automatico attivo: il prossimo tentativo verrà programmato se il passaggio resta fermo.";
    return;
  }
  const seconds = Math.max(
      0,
      Math.ceil((new Date(due).getTime() - Date.now()) / 1000),
    ),
    attempt = appState.autoRetry?.attempt ?? 1;
  el.textContent = seconds
    ? `Tentativo automatico ${attempt} di 3 tra ${seconds} secondi. Se anche il terzo fallisce, salto questo immobile e i suoi nominativi e continuo.`
    : "Riprova automatica in avvio…";
}
setInterval(() => {
  updateAutoRetryCountdown();
  renderRetryMonitor();
}, 1000);
renderCompletedImports = renderCompletedSessions;
function renderRequestArchive() {
  const state = appState?.requestArchive ?? {},
    run = state.latestRun,
    progress = state.progress,
    active = Boolean(state.active),
    schemaError = state.schemaError,
    error = state.lastError || run?.error_message;
  const done = run?.status === "completed",
    partial = ["failed", "cancelled", "completed_with_errors"].includes(
      run?.status,
    );
  let title = "Pronto per la prima sincronizzazione",
    message = "La scheda dell’archivio deve rimanere aperta e autenticata.",
    badge = "Mai eseguita",
    tone = "is-idle";
  if (schemaError) {
    title = "Aggiornamento archivio dati necessario";
    message = schemaError;
    badge = "Da configurare";
    tone = "is-error";
  } else if (active && progress?.phase === "index") {
    title = "Sto leggendo tutte le pagine dell’archivio";
    message = progress.title;
    badge = "Indicizzazione";
    tone = "is-running";
  } else if (active && progress) {
    title = progress.title;
    message = `Richiesta ${progress.index} di ${progress.total}${progress.failed ? ` · ${progress.failed} da riprovare` : ""}`;
    badge = state.cancelling ? "Interruzione…" : "Sincronizzazione";
    tone = state.cancelling ? "is-error" : "is-running";
  } else if (done) {
    title = `${run.processed_requests} richieste sincronizzate`;
    message = `Ultimo aggiornamento ${fmtDate(run.completed_at ?? run.updated_at)}`;
    badge = "Completata";
    tone = "is-complete";
  } else if (partial) {
    title = `${run?.processed_requests ?? 0} richieste già acquisite`;
    message =
      error || `${run?.failed_requests ?? 0} richieste restano da riprovare`;
    badge = "Riprendibile";
    tone = "is-resumable";
  } else if (error) {
    title = "La sincronizzazione richiede attenzione";
    message = error;
    badge = "Errore";
    tone = "is-error";
  }
  $("requestArchiveTitle").textContent = title;
  $("requestArchiveMessage").textContent = message;
  $("requestArchiveBadge").className = `status-pill ${tone}`;
  $("requestArchiveBadge").innerHTML = `<span></span>${badge}`;
  const start = $("requestArchiveStart"),
    cancel = $("requestArchiveCancel"),
    fresh = $("requestArchiveNew"),
    resume = partial && run?.id;
  start.textContent = resume
    ? "Riprendi sincronizzazione"
    : done
      ? "Aggiorna archivio"
      : "Sincronizza richieste";
  start.dataset.resumeRun = resume ? run.id : "";
  start.disabled = active || Boolean(appState?.active) || Boolean(schemaError);
  cancel.classList.toggle("is-hidden", !active);
  cancel.disabled = Boolean(state.cancelling);
  fresh.classList.toggle("is-hidden", !partial || active);
  fresh.disabled = Boolean(appState?.active) || Boolean(schemaError);
  const bar = $("requestArchiveProgress"),
    percent = progress?.total
      ? Math.round(Math.min(100, (progress.index / progress.total) * 100))
      : done
        ? 100
        : 0;
  bar.classList.toggle("is-hidden", !active && !done);
  bar.querySelector("span").style.width = `${percent}%`;
}
function renderMandateArchive() {
  const state = appState?.mandateArchive ?? {},
    run = state.latestRun,
    progress = state.progress,
    active = Boolean(state.active),
    schemaError = state.schemaError,
    error = state.lastError || run?.error_message;
  const done = run?.status === "completed",
    partial = ["failed", "cancelled", "completed_with_errors"].includes(
      run?.status,
    );
  let title = "Pronto per la prima sincronizzazione",
    message =
      "La scheda “Incarichi aperti” deve rimanere aperta e autenticata.",
    badge = "Mai eseguita",
    tone = "is-idle";
  if (schemaError) {
    title = "Aggiornamento archivio dati necessario";
    message = schemaError;
    badge = "Da configurare";
    tone = "is-error";
  } else if (active && progress?.phase === "index") {
    title = "Sto leggendo tutte le pagine dell’archivio";
    message = progress.title;
    badge = "Indicizzazione";
    tone = "is-running";
  } else if (active && progress) {
    title = progress.title;
    message = `Incarico ${progress.index} di ${progress.total}${progress.failed ? ` · ${progress.failed} da riprovare` : ""}`;
    badge = state.cancelling ? "Interruzione…" : "Sincronizzazione";
    tone = state.cancelling ? "is-error" : "is-running";
  } else if (done) {
    title = `${run.processed_mandates} immobili sincronizzati`;
    message = `Ultimo aggiornamento ${fmtDate(run.completed_at ?? run.updated_at)}`;
    badge = "Completata";
    tone = "is-complete";
  } else if (partial) {
    title = `${run?.processed_mandates ?? 0} immobili già acquisiti`;
    message =
      error || `${run?.failed_mandates ?? 0} incarichi restano da riprovare`;
    badge = "Riprendibile";
    tone = "is-resumable";
  } else if (error) {
    title = "La sincronizzazione richiede attenzione";
    message = error;
    badge = "Errore";
    tone = "is-error";
  }
  $("mandateArchiveTitle").textContent = title;
  $("mandateArchiveMessage").textContent = message;
  $("mandateArchiveBadge").className = `status-pill ${tone}`;
  $("mandateArchiveBadge").innerHTML = `<span></span>${badge}`;
  const start = $("mandateArchiveStart"),
    cancel = $("mandateArchiveCancel"),
    fresh = $("mandateArchiveNew"),
    resume = partial && run?.id;
  start.textContent = resume
    ? "Riprendi sincronizzazione"
    : done
      ? "Aggiorna portafoglio"
      : "Sincronizza incarichi";
  start.dataset.resumeRun = resume ? run.id : "";
  start.disabled =
    active ||
    Boolean(appState?.active) ||
    Boolean(appState?.requestArchive?.active) ||
    Boolean(schemaError);
  cancel.classList.toggle("is-hidden", !active);
  cancel.disabled = Boolean(state.cancelling);
  fresh.classList.toggle("is-hidden", !partial || active);
  fresh.disabled =
    Boolean(appState?.active) ||
    Boolean(appState?.requestArchive?.active) ||
    Boolean(schemaError);
  const bar = $("mandateArchiveProgress"),
    percent = progress?.total
      ? Math.round(Math.min(100, (progress.index / progress.total) * 100))
      : done
        ? 100
        : 0;
  bar.classList.toggle("is-hidden", !active && !done);
  bar.querySelector("span").style.width = `${percent}%`;
}
function renderStreetRun() {
  const state = appState?.streetRun ?? {},
    checkpoint = state.checkpoint,
    active = Boolean(state.active),
    error = state.lastError || checkpoint?.lastError;
  const start = $("streetRunStart"),
    cancel = $("streetRunCancel"),
    abandon = $("streetRunAbandon"),
    input = $("streetRunInput"),
    dryToggle = $("dryRunToggle"),
    streetFilterInputs = ["streetFloorMode", "streetFloorValue", "streetMinCivic", "streetMaxCivic", "streetResidentialOnly"]
      .map((id) => $(id));
  dryToggle.disabled = active;
  input.disabled = active;
  for (const control of streetFilterInputs) control.disabled = active;
  $("streetFloorValue").disabled = active || $("streetFloorMode").value === "any";
  $("streetRunStartLabel").textContent = dryToggle.checked ? "Avvia dry-run" : "Avvia run reale";
  start.disabled =
    Boolean(appState?.active) ||
    Boolean(appState?.requestArchive?.active) ||
    Boolean(appState?.mandateArchive?.active);
  start.classList.toggle("is-hidden", active);
  cancel.classList.toggle("is-hidden", !active);
  cancel.disabled = Boolean(state.cancelling);
  abandon.classList.toggle("is-hidden", !active);
  abandon.textContent = "Interrompi";
  abandon.disabled = Boolean(appState?.stoppingAll);
  if (!active || !checkpoint) {
    $("streetRunSummary").classList.add("is-hidden");
    $("streetRunSummary").innerHTML = "";
    $("streetRunProgress").classList.add("is-hidden");
    return;
  }
  $("streetRunSummary").classList.remove("is-hidden");
  const variants = checkpoint.variants ?? [],
    completedVariants = Math.min(
      checkpoint.currentVariantIndex ?? 0,
      variants.length,
    ),
    percent = variants.length
      ? Math.round((completedVariants / variants.length) * 100)
      : 0,
    failed = (checkpoint.results ?? []).filter(
      (result) => result.outcome === "failed",
    ).length,
    occurrences =
      checkpoint.totalAcceptedOccurrences ??
      checkpoint.totalAcceptedProperties ??
      0,
    filterSkips = (checkpoint.results ?? []).reduce((total, result) =>
      total + Object.values(result.filterSkips ?? {}).reduce((sum, count) => sum + Number(count ?? 0), 0), 0),
    activeFilters = [
      checkpoint.filters?.residentialOnly !== false ? "solo abitazioni" : null,
      checkpoint.filters?.floorMode !== "any" && checkpoint.filters?.floorValue != null
        ? `piano ${checkpoint.filters.floorMode === "exact" ? "=" : checkpoint.filters.floorMode === "minimum" ? "≥" : "≤"} ${checkpoint.filters.floorValue}` : null,
      checkpoint.filters?.minCivicNumber != null || checkpoint.filters?.maxCivicNumber != null
        ? `civici ${checkpoint.filters.minCivicNumber ?? "inizio"}–${checkpoint.filters.maxCivicNumber ?? "fine"}` : null,
    ].filter(Boolean).join(" · ");
  $("streetRunSummary").innerHTML =
    `<div class="street-run-current"><div><small>Varianti esatte</small><strong>${completedVariants}/${variants.length}</strong><span>Acquisizione di ogni variante in corso</span></div><dl><div><dt>Righe lette</dt><dd>${checkpoint.totalRawRecords ?? 0}</dd></div><div><dt>Case distinte</dt><dd>${checkpoint.totalAcceptedProperties ?? 0}</dd></div><div><dt>Righe tenute</dt><dd>${occurrences}</dd></div><div><dt>Escluse dai filtri</dt><dd>${filterSkips}</dd></div><div><dt>Interrogazioni fallite</dt><dd>${failed}</dd></div></dl></div><p class="street-run-variants"><b>${esc(checkpoint.requestedStreet)}</b> · ${esc(checkpoint.mode === "live" ? "run reale" : "dry-run")}${activeFilters ? ` · ${esc(activeFilters)}` : ""} · ${variants.map((v, index) => `variante ${esc(v.sourceId)}: ${index < completedVariants ? "completata" : index === completedVariants && active ? "in corso" : "in attesa"}`).join(" · ")}${checkpoint.totalOwnersRead ? `<br>Proprietari letti: <b>${checkpoint.totalOwnersRead}</b>` : ""}${error ? `<br><b>Errore della run corrente:</b> ${esc(error)}` : ""}</p>`;
  const progress = $("streetRunProgress");
  progress.classList.remove("is-hidden");
  progress.querySelector("span").style.width = `${percent}%`;
}
/* La coda del registro e' un dato del database, non una preferenza locale:
 * qui si mostra soltanto, l'ordine e la presa in carico li decide il server. */
function renderStreetRegistry() {
  const registry = appState?.streetRegistry ?? {},
    claim = registry.claim ?? null,
    queue = Array.isArray(registry.queue) ? registry.queue : [],
    streetActive = Boolean(appState?.streetRun?.active),
    network = registry.network ?? {},
    start = $("networkRegistryStart"),
    pause = $("networkRegistryPause"),
    refresh = $("networkRegistryRefresh"),
    zone = $("networkRegistryZone"),
    next = $("networkRegistryNext"),
    meta = $("networkRegistryMeta"),
    list = $("networkRegistryQueue"),
    errore = $("networkRegistryError");

  const zones = Array.isArray(registry.zones) ? registry.zones : [],
    selectedZoneId = registry.selectedZoneId ?? "",
    zoneOptionsKey = zones.map((item) => `${item.id}:${item.zone_number}:${item.name}`).join("|");
  if (zone.dataset.optionsKey !== zoneOptionsKey) {
    zone.innerHTML = '<option value="">Tutta Bitonto · dal centro città</option>'
      + zones.map((item) => `<option value="${esc(item.id)}">${item.zone_number == null ? "" : `${esc(String(item.zone_number))} · `}${esc(item.name)}</option>`).join("");
    zone.dataset.optionsKey = zoneOptionsKey;
  }
  zone.value = selectedZoneId;

  start.disabled = streetActive
    || Boolean(network.active)
    || Boolean(registry.loading)
    || Boolean(appState?.active)
    || Boolean(appState?.requestArchive?.active)
    || Boolean(appState?.mandateArchive?.active);
  start.classList.toggle("is-hidden", Boolean(network.active));
  pause.classList.toggle("is-hidden", !network.active);
  pause.disabled = Boolean(network.stopping);
  refresh.disabled = Boolean(registry.loading) || Boolean(network.active);
  zone.disabled = Boolean(registry.loading) || Boolean(network.active) || Boolean(claim);

  if (claim) {
    next.textContent = network.active
      ? `In lavorazione: ${claim.canonical_name}`
      : `Da riprendere: ${claim.canonical_name}`;
    meta.textContent = descriviPosizioneVia(claim);
  } else if (registry.loading) {
    next.textContent = "Carico la coda…";
    meta.textContent = "";
  } else if (queue.length) {
    next.textContent = `Prossima via: ${queue[0].canonical_name}`;
    meta.textContent = descriviPosizioneVia(queue[0]);
  } else {
    next.textContent = "Nessuna via in attesa nel registro.";
    meta.textContent = registry.lastError ? "" : "La coda è esaurita oppure le lavorazioni sono già prese in carico.";
  }

  list.innerHTML = queue.slice(0, 10).map((item) => {
    const zoneScope = Boolean(selectedZoneId),
      rank = zoneScope ? item.zone_rank : item.city_rank,
      senzaRank = rank == null;
    return `<li class="${senzaRank ? "is-unranked" : ""}">`
      + `<span class="srq-rank">${senzaRank ? "—" : esc(String(rank))}</span>`
      + `<span class="srq-name">${esc(item.canonical_name)}</span>`
      + `<span class="srq-zone">${esc(senzaRank ? "senza posizione" : item.zone_name || "zona non assegnata")}</span>`
      + "</li>";
  }).join("");

  errore.classList.toggle("is-hidden", !registry.lastError);
  errore.textContent = registry.lastError ?? "";
}

function descriviPosizioneVia(item) {
  if (!item) return "";
  const zoneScope = Boolean(appState?.streetRegistry?.selectedZoneId);
  if (zoneScope && item.zone_rank != null) {
    const distanzaZona = item.zone_distance_m == null ? null : `${Math.round(Number(item.zone_distance_m))} m dal centro zona`;
    return [`${item.zone_rank}ª nella zona`, distanzaZona, item.zone_name].filter(Boolean).join(" · ");
  }
  if (item.city_rank == null) {
    return "Senza geometria: nessuna posizione dal centro, resta in fondo alla coda in ordine di Codvia.";
  }
  const distanza = item.city_distance_m == null ? null : `${Math.round(Number(item.city_distance_m))} m dal centro`;
  return [`${item.city_rank}ª dal centro`, distanza, item.zone_name].filter(Boolean).join(" · ");
}

function renderStreetRunInternalProgress(progress) {
  if (!progress) return;
  const summary = $("streetRunSummary"),
    checkpoint = appState?.streetRun?.checkpoint,
    variants = checkpoint?.variants ?? [];
  let line = $("streetRunInternalProgress");
  if (!line) {
    line = document.createElement("p");
    line.id = "streetRunInternalProgress";
    line.className = "street-run-internal-progress";
    summary.appendChild(line);
  }
  const labels = {
      preparing: "Preparo la scansione",
      "loading-results": "Attendo l'elenco completo da SISTER",
      "parsing-properties": "Leggo la tabella immobili",
      "reading-owners": "Leggo gli intestatari",
      returning: "Ritorno all'elenco indirizzi",
    },
    position = progress.total
      ? ` ${progress.current} di ${progress.total}`
      : "",
    address = progress.address ? ` · ${progress.address}` : "";
  line.textContent = `${labels[progress.phase] ?? "Scansione in corso"}${position}${address}`;
  const completed = Math.min(
      checkpoint?.currentVariantIndex ?? 0,
      variants.length,
    ),
    fraction = progress.total
      ? Math.min(1, progress.current / progress.total)
      : 0,
    percent = variants.length
      ? Math.round(((completed + fraction) / variants.length) * 100)
      : 0;
  $("streetRunProgress").classList.remove("is-hidden");
  $("streetRunProgress").querySelector("span").style.width = `${percent}%`;
}
function renderNetworkCounters(checkpoint, state) {
  const counters = $("networkRunCounters");
  if (!counters) return;
  if (!checkpoint) {
    counters.classList.add("is-hidden");
    counters.innerHTML = "";
    return;
  }
  const skipped = checkpoint.skipped ?? {},
    skipTotal = Object.values(skipped).reduce((sum, value) => sum + Number(value || 0), 0),
    depth = state?.progress?.depth ?? checkpoint.pending?.[0]?.depth ?? null,
    rows = [
      // «CF in coda», non «in coda»: qui il numero conta persone da visitare,
      // e «in coda» in questa app ha sempre voluto dire immobili.
      ["CF in coda", `${checkpoint.pending?.length ?? 0}`, "Codici fiscali ancora da visitare"],
      ["Ottenuti", `${checkpoint.acceptedProperties ?? 0}/${checkpoint.settings.targetProperties}`, "Immobili accettati sul totale richiesto"],
      ["Livello", depth == null ? "—" : `${depth}/${checkpoint.settings.maxDepth}`, "Distanza dai codici fiscali di partenza"],
      ["Scartati", `${skipTotal}`, "Candidati esclusi dai filtri o dal controllo catastale"],
    ];
  counters.classList.remove("is-hidden");
  counters.innerHTML = rows.map(([name, value, hint]) => `<div title="${esc(hint)}"><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join("");
}
function renderNetworkRun() {
  const registry = appState?.streetRegistry ?? {},
    network = registry.network ?? {},
    progress = network.progress ?? null,
    active = Boolean(network.active),
    ids = ["networkStreetFloorMode", "networkStreetFloorValue", "networkStreetMinCivic", "networkStreetMaxCivic", "networkStreetResidentialOnly"];
  ids.forEach((id) => { $(id).disabled = active; });
  $("networkStreetFloorValue").disabled = active || $("networkStreetFloorMode").value === "any";
  const summary = $("networkRegistrySummary");
  if (!active && !progress) {
    summary.classList.add("is-hidden");
    summary.innerHTML = "";
    return;
  }
  summary.classList.remove("is-hidden");
  const completed = progress?.completedStreets ?? 0,
    processed = progress?.processedStreets ?? 0,
    recheck = progress?.recheckStreets ?? 0,
    failed = progress?.failedStreets ?? 0,
    current = progress?.currentStreet ?? registry.claim?.canonical_name ?? null;
  const error = network.lastError ?? registry.lastError;
  summary.innerHTML = `<div class="street-run-current network-run-current"><div><small>Vie completate</small><strong>${completed}</strong><span>${current ? `Ora: ${esc(current)}` : active ? "Cerco la prossima via" : "Sessione terminata"}</span></div><dl><div><dt>Lavorate</dt><dd>${processed}</dd></div><div><dt>Da controllare</dt><dd>${recheck}</dd></div><div><dt>Fallite</dt><dd>${failed}</dd></div></dl></div>${error ? `<p class="street-run-variants"><b>Attenzione:</b> ${esc(error)}</p>` : ""}`;
}
function rigaDiario(x) {
  return `<div class="activity-item is-${x.tone}"><time>${fmtTime(x.at)}</time><i></i><p>${esc(x.message)}</p></div>`;
}

function firmaRigaDiario(x) {
  return x ? `${x.at}${x.message}` : "";
}

/**
 * Il diario delle operazioni, scritto una riga alla volta.
 *
 * Ogni riga di diario ridisegnava tutte e trecento le righe — e con loro i due
 * pannelli degli archivi, che con il diario non c'entrano niente. Durante una
 * run il diario scrive di continuo: era l'interfaccia che si inchiodava mentre
 * il worker lavorava, cioè esattamente quando serviva poterla guardare.
 *
 * Adesso le righe nuove si aggiungono in cima e quelle in fondo cadono: si
 * ridisegna tutto solo quando il diario è cambiato in un modo che non è
 * «sono arrivate delle righe nuove».
 */
function renderActivity() {
  const items = appState?.activity ?? [];
  const lista = $("activityList");
  const cima = firmaRigaDiario(items[0]);

  if (cima === attivitaCimaDisegnata && items.length === attivitaRigheDisegnate) return;

  if (!items.length) {
    lista.innerHTML = `<p class="empty-message">Qui compariranno le operazioni svolte.</p>`;
    attivitaCimaDisegnata = "";
    attivitaRigheDisegnate = 0;
    return;
  }

  /* Quante righe sono comparse in cima rispetto all'ultimo disegno. -1 vuol
   * dire «non lo so»: si ridisegna tutto. */
  let nuove = -1;
  if (attivitaCimaDisegnata && attivitaRigheDisegnate) {
    const limite = Math.min(items.length, 32);
    for (let indice = 0; indice < limite; indice += 1) {
      if (firmaRigaDiario(items[indice]) === attivitaCimaDisegnata) {
        nuove = indice;
        break;
      }
    }
  }

  if (nuove > 0 && lista.firstElementChild && !lista.querySelector(".empty-message")) {
    lista.insertAdjacentHTML("afterbegin", items.slice(0, nuove).map(rigaDiario).join(""));
    while (lista.childElementCount > MAX_RIGHE_DIARIO) lista.lastElementChild.remove();
  } else if (nuove !== 0) {
    lista.innerHTML = items.slice(0, MAX_RIGHE_DIARIO).map(rigaDiario).join("");
  }

  attivitaCimaDisegnata = cima;
  attivitaRigheDisegnate = items.length;
}
function renderDiagnosticErrors() {
  const items = appState?.diagnosticErrors ?? [];
  $("diagnosticErrorCount").textContent = items.length;
  /* Ogni arresto porta con sé il suo dettaglio tecnico in JSON indentato:
   * riscriverli tutti a ogni disegno costa, e cambiano solo quando il worker
   * si ferma. */
  const renderKey = items.map((item) => `${item.at}${item.jobId ?? ""}`).join("|");
  if (renderKey === diagnosticiRenderKey) return;
  diagnosticiRenderKey = renderKey;
  $("diagnosticErrorList").innerHTML = items.length
    ? items
        .map((item) => {
          const action =
              item.details?.action ??
              item.details?.operationLabel ??
              "Operazione non identificata",
            property =
              item.details?.propertyAddress ?? item.details?.cadastralKey,
            technical = JSON.stringify(item.details ?? {}, null, 2);
          return `<article class="diagnostic-error-item"><header><div><b>${esc(item.message)}</b><small>${fmtDate(item.at)} · ${esc(item.source)} · ${esc(item.status)}</small></div><span>${esc(item.jobId?.slice(0, 8) ?? "—")}</span></header><p><b>Passaggio:</b> ${esc(action)}${property ? ` · <b>Immobile:</b> ${esc(property)}` : ""}</p><details><summary>Dettagli tecnici</summary><pre>${esc(technical)}</pre></details></article>`;
        })
        .join("")
    : `<p class="empty-message">Nessun arresto registrato.</p>`;
}
function renderSoftwareUpdate() {
  const state = appState?.softwareUpdate ?? {
    status: "unavailable",
    currentVersion: appState?.version,
    message: "Controllo non disponibile",
    percent: null,
  };
  const active = Boolean(appState?.active);
  let action = "check",
    label = "Controlla adesso",
    disabled = false;
  if (state.status === "checking") {
    label = "Controllo in corso…";
    disabled = true;
  } else if (state.status === "available") {
    action = "download";
    label = active
      ? "Termina prima il lavoro"
      : `Scarica v${state.availableVersion}`;
    disabled = active;
  } else if (state.status === "downloading") {
    action = "download";
    label = `Scaricamento ${Math.round(state.percent ?? 0)}%`;
    disabled = true;
  } else if (state.status === "downloaded") {
    action = "install";
    label = active ? "Termina prima il lavoro" : "Installa e riavvia";
    disabled = active;
  } else if (state.status === "unavailable") {
    label = "Solo nell’app installata";
    disabled = true;
  } else if (state.status === "up_to_date") {
    label = "Controlla di nuovo";
  } else if (state.status === "error") {
    label = "Riprova il controllo";
  }
  const title =
    state.status === "available"
      ? `Versione ${state.availableVersion} disponibile`
      : state.status === "downloaded"
        ? "Aggiornamento pronto"
        : state.status === "up_to_date"
          ? `Versione ${state.currentVersion} aggiornata`
          : "Aggiornamenti del programma";
  $("softwareUpdateTitle").textContent = title;
  $("softwareUpdateMessage").textContent = state.message;
  const progress = $("softwareUpdateProgress");
  progress.classList.toggle("is-hidden", state.status !== "downloading");
  progress.querySelector("span").style.width =
    `${Math.max(0, Math.min(100, state.percent ?? 0))}%`;
  const settingsButton = $("softwareUpdateAction");
  const cancelButton = $("softwareUpdateCancel");
  cancelButton.classList.toggle("is-hidden", state.status !== "downloading");
  cancelButton.disabled = Boolean(appState?.stoppingAll);
  settingsButton.dataset.updateAction = action;
  settingsButton.textContent = label;
  settingsButton.disabled = disabled;
  settingsButton.className = `button ${["available", "downloaded"].includes(state.status) ? "primary" : "secondary"}`;
  const headerButton = $("updateButton");
  headerButton.dataset.updateAction = action;
  headerButton.textContent =
    state.status === "available"
      ? `Aggiorna a v${state.availableVersion}`
      : state.status === "downloaded"
        ? "Installa aggiornamento"
        : state.status === "downloading"
          ? `${Math.round(state.percent ?? 0)}% scaricato`
          : state.status === "up_to_date"
            ? "Programma aggiornato"
            : "Controlla aggiornamenti";
  headerButton.disabled = disabled;
  headerButton.className = `button ${["available", "downloaded"].includes(state.status) ? "primary" : "secondary"}`;
}

function renderStopAll() {
  const canStop =
    Boolean(appState?.active) ||
    Boolean(appState?.requestArchive?.active) ||
    Boolean(appState?.mandateArchive?.active) ||
    Boolean(appState?.streetRun?.active) ||
    Boolean(appState?.networkRun?.active) ||
    appState?.softwareUpdate?.status === "downloading";
  const button = $("stopAllButton");
  button.classList.toggle("is-hidden", !canStop);
  button.disabled = Boolean(appState?.stoppingAll);
  button.textContent = appState?.stoppingAll ? "Arresto in corso…" : "Arresta processo";
}
function renderReview() {
  const dialog = $("acquisitionReviewDialog"),
    review =
      appState?.prompt?.kind === "acquisition-review"
        ? appState.prompt.review
        : null;
  if (!review) {
    if (dialog.open) dialog.close();
    return;
  }
  const issues = review.acquisitionIssues ?? [];
  $("acquisitionReviewContext").textContent =
    [review.municipality, review.street, review.civicNumber]
      .filter(Boolean)
      .join(" · ") || "Risultati acquisiti";
  $("acquisitionReviewCount").textContent =
    `${review.properties.length} immobili acquisiti${issues.length ? ` · ${issues.length} righe escluse` : ""}`;
  const issueCards = issues
    .map(
      (issue) =>
        `<article class="review-property is-warning"><section class="review-owners"><p class="eyebrow">Riga esclusa dal paracadute</p><strong>${esc(issue.status === "acquisition_skipped" ? "Saltata manualmente" : "Non acquisibile dopo i tentativi")}</strong><p>${esc(issue.reason)}</p></section><section class="review-property-data"><h3>${esc(issue.address ?? "Indirizzo non disponibile")}</h3><p>${esc(issue.cadastralKey)}</p></section></article>`,
    )
    .join("");
  $("acquisitionReviewContent").innerHTML =
    issueCards +
    review.properties
      .map(
        (p, i) =>
          `<article class="review-property"><section class="review-owners"><p class="eyebrow">Proprietari · ${p.owners.length}</p>${p.owners.map((o) => `<div class="review-owner"><div><strong>${esc(o.fullName)}</strong><small>${esc(o.taxCode ?? "CF mancante")}</small></div><div><span>${esc([o.birthPlace, o.birthDate].filter(Boolean).join(" · ") || "Nascita non disponibile")}</span><b>${o.sharePercentage == null ? "Quota n/d" : `${new Intl.NumberFormat("it-IT").format(o.sharePercentage)}%`}</b></div></div>`).join("") || "Nessun proprietario"}</section><section class="review-property-data"><p class="eyebrow">Immobile ${i + 1}</p><h3>${esc(p.address ?? "Indirizzo non disponibile")}</h3><p>${esc(p.cadastralKey)}</p><dl><div><dt>Categoria</dt><dd>${esc(p.category ?? "—")}</dd></div><div><dt>Classe</dt><dd>${esc(p.class ?? "—")}</dd></div><div><dt>Consistenza</dt><dd>${esc(p.consistency ?? "—")}</dd></div><div><dt>Rendita</dt><dd>${p.cadastralIncome == null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(p.cadastralIncome)}</dd></div></dl></section></article>`,
      )
      .join("");
  if (!dialog.open) dialog.showModal();
}

function input(name, label, value, type = "text") {
  return `<label class="manual-field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value ?? "")}" /></label>`;
}
function renderCorrections() {
  const panel = $("manualCorrectionPanel"),
    container = $("manualCorrectionFields");
  if (!resolutionDetail) {
    container.innerHTML = `<p class="empty-message">Apri una lavorazione per vedere i dati correggibili.</p>`;
    return;
  }
  const props = resolutionDetail.properties ?? [],
    people = resolutionDetail.people ?? [],
    ownerships = resolutionDetail.ownerships ?? [];
  container.innerHTML = props.length
    ? props
        .map((p, index) => {
          const related = ownerships
            .filter((o) => o.property_id === p.id)
            .map((o) => ({
              ownership: o,
              person: people.find((person) => person.id === o.person_id),
            }))
            .filter((item) => item.person);
          const confirming = pendingPropertyRemovalId === p.id;
          return `<article class="manual-property-card${confirming ? " is-removal-pending" : ""}" data-property-card-id="${p.id}"><header><div><p class="eyebrow">Immobile ${index + 1} di ${props.length}</p><h3>${esc(p.address ?? "Immobile senza indirizzo")}</h3></div><div class="manual-card-actions"><strong>${esc([p.sheet, p.parcel, p.subaltern].join(" · "))}</strong><button type="button" class="manual-remove-button" data-remove-property="${p.id}" aria-label="Rimuovi questo immobile dalla lavorazione" title="Rimuovi dalla lavorazione">×</button></div></header>${confirming ? `<div class="manual-removal-confirmation" role="alert"><div><strong>Rimuovere questo immobile dalla lavorazione?</strong><p>Verranno eliminati anche i nominativi collegati soltanto a questo immobile. Quelli presenti su altri immobili resteranno al sicuro.</p></div><div><button type="button" class="button secondary" data-cancel-property-removal>Annulla</button><button type="button" class="button danger solid" data-confirm-property-removal="${p.id}" ${propertyRemovalInFlight ? "disabled" : ""}>${propertyRemovalInFlight ? "Rimozione…" : "Rimuovi"}</button></div></div>` : ""}<div class="manual-property-columns"><section class="manual-owners-column"><h4>Dati dei proprietari</h4><p>Controlla anagrafica e quota riferita a questo immobile.</p>${related.map(({ ownership, person }) => `<div class="manual-owner" data-person-id="${person.id}" data-ownership-id="${ownership.id}"><h5>${esc(person.full_name)}</h5><div class="manual-grid">${input("fullName", "Nome completo", person.full_name)}${input("taxCode", "Codice fiscale", person.tax_code)}${input("birthPlace", "Luogo di nascita", person.birth_place)}${input("birthProvince", "Provincia", person.birth_province)}${input("birthDate", "Data di nascita", person.birth_date, "date")}${input("sharePercentage", "Quota su questo immobile (%)", ownership.share_percentage ?? person.share_percentage, "number")}<input name="shareOriginal" type="hidden" value="${esc(person.share_original || "1/1")}" /></div></div>`).join("") || `<p class="empty-message">Nessun proprietario collegato. Correggi i dati SISTER prima di riprendere.</p>`}</section><section class="manual-property-column" data-property-id="${p.id}"><h4>Dati dell'immobile</h4><p>Controlla identificativi catastali e indirizzo.</p><div class="manual-grid">${input("sheet", "Foglio", p.sheet)}${input("parcel", "Particella", p.parcel)}${input("subaltern", "Subalterno", p.subaltern)}${input("category", "Categoria", p.category)}${input("address", "Indirizzo", p.address)}${input("class", "Classe", p.class)}${input("consistency", "Consistenza", p.consistency)}${input("cadastralIncome", "Rendita", p.cadastral_income, "number")}</div></section></div></article>`;
        })
        .join("")
    : `<div class="manual-corrections-empty"><strong>Non ci sono più immobili in questa lavorazione.</strong><p>Puoi chiudere questa sezione oppure annullare definitivamente il lavoro.</p></div>`;
  const submit = $("manualCorrectionForm").querySelector(
    'button[type="submit"]',
  );
  submit.disabled = !props.length;
  panel.classList.remove("is-hidden");
}
async function loadResolution(jobId, show = true) {
  resolutionJobId = jobId;
  resolutionDetail = await window.propertyWorker.getJobDetails(jobId);
  if (show) {
    renderCorrections();
    goTo("manualCorrectionPanel");
  }
}
function nullableNumber(value) {
  return value.trim() === "" ? null : Number(value.replace(",", "."));
}

/**
 * Un campo vuoto vuol dire «usa il valore predefinito», non zero.
 *
 * `Number("")` restituisce 0, non `NaN`: mandando quello, il normalizzatore
 * della run lo prendeva per un numero valido e lo stringeva dentro l'intervallo
 * consentito. Lasciare vuoto «Persone da visitare» non dava il tetto di 80: ne
 * dava 1, e la run visitava una persona sola e si chiudeva dicendo che era
 * andata bene. Con `undefined` il predefinito documentato torna a valere.
 */
function numeroOMancante(value) {
  return String(value).trim() === "" ? undefined : Number(String(value).replace(",", "."));
}

/**
 * I filtri della rete proprietari.
 *
 * Ogni gruppo e' un bottone: si apre uno per volta, cosi' la scheda non
 * cresce mai in altezza e non nasce lo scorrimento interno. Un bottone acceso
 * dice che quel filtro ha un valore e restringera' la ricerca — si vede senza
 * doverlo aprire.
 *
 * Nessun campo e' obbligatorio: quello che lasci vuoto non limita niente, e
 * per l'estensione della rete vale il valore predefinito scritto nel
 * segnaposto.
 */
const FILTRI_RETE = {
  floor: ["networkFloorMode", "networkFloorValue"],
  age: ["networkMinOwnerAge", "networkMaxOwnerAge"],
  count: ["networkMinOwnerCount", "networkMaxOwnerCount"],
  civic: ["networkMinCivic", "networkMaxCivic"],
  share: ["networkMinShare"],
  reach: ["networkMaxDepth", "networkSeedCount", "networkMaxPeople"],
};

let filtroReteAperto = null;

/** Un filtro e' attivo quando almeno un suo campo dice qualcosa. */
function filtroReteAttivo(gruppo) {
  if (gruppo === "floor") {
    return $("networkFloorMode").value !== "any" && $("networkFloorValue").value.trim() !== "";
  }
  return (FILTRI_RETE[gruppo] ?? []).some((id) => $(id).value.trim() !== "");
}

function svuotaFiltroRete(gruppo) {
  for (const id of FILTRI_RETE[gruppo] ?? []) {
    if (id === "networkFloorMode") $(id).value = "any";
    else $(id).value = "";
  }
  if (gruppo === "floor") $("networkFloorValue").disabled = true;
}

function apriFiltroRete(gruppo) {
  filtroReteAperto = filtroReteAperto === gruppo ? null : gruppo;
  /* Aprendo un gruppo si chiude il precedente, spiegazione compresa: due
   * pannelli aperti riporterebbero lo scorrimento da cui siamo partiti. */
  for (const esistente of Object.keys(FILTRI_RETE)) {
    const spiegazione = document.querySelector(`[data-net-explain="${esistente}"]`);
    if (spiegazione && esistente !== filtroReteAperto) {
      spiegazione.hidden = true;
      document.querySelector(`[data-net-info="${esistente}"]`)?.setAttribute("aria-expanded", "false");
    }
  }
  renderFiltriRete();
  if (filtroReteAperto) {
    const pannello = document.querySelector(`[data-net-panel="${filtroReteAperto}"]`);
    pannello?.querySelector("input:not([disabled]), select")?.focus();
  }
}

/* La scheda si allarga quando una spiegazione e' aperta, invece di scorrere. */
function adeguaAltezzaCarosello() {
  const apertaUnaSpiegazione = Boolean(
    document.querySelector(".net-explain:not([hidden])"),
  );
  document.querySelector(".run-carousel")?.classList.toggle("is-tall", apertaUnaSpiegazione);
}

function renderFiltriRete() {
  const inCorso = Boolean(appState?.networkRun?.active);
  let almenoUnoAttivo = false;

  for (const gruppo of Object.keys(FILTRI_RETE)) {
    const attivo = filtroReteAttivo(gruppo);
    almenoUnoAttivo = almenoUnoAttivo || attivo;

    const chip = document.querySelector(`[data-net-chip="${gruppo}"]`);
    if (chip) {
      chip.classList.toggle("is-active", attivo);
      chip.classList.toggle("is-open", filtroReteAperto === gruppo);
      chip.setAttribute("aria-expanded", String(filtroReteAperto === gruppo));
      chip.disabled = inCorso;
    }

    const pannello = document.querySelector(`[data-net-panel="${gruppo}"]`);
    if (pannello) pannello.hidden = filtroReteAperto !== gruppo;

    const azzera = document.querySelector(`[data-net-clear="${gruppo}"]`);
    if (azzera) azzera.disabled = inCorso || !attivo;
  }

  const azzeraTutti = $("networkFilterReset");
  if (azzeraTutti) {
    azzeraTutti.hidden = !almenoUnoAttivo;
    azzeraTutti.disabled = inCorso;
  }

  adeguaAltezzaCarosello();
}

function render() {
  if (!appState) return;
  selectedMode = appState.preferences?.mode ?? selectedMode;
  const job = currentJob(),
    completed =
      job?.status === "completed" || appState.currentStep === "completed";
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.classList.toggle("is-selected", b.dataset.mode === selectedMode),
    );
  $("modeHelp").textContent =
    selectedMode === "automatic"
      ? "Procede da solo e si ferma solo quando non può scegliere in sicurezza."
      : "Ti chiede conferma prima dei salvataggi.";
  $("dryRunToggle").checked = appState.preferences?.keepAcquisition !== false;
  $("versionLabel").textContent = `v${appState.version}`;
  $("excelPath").textContent =
    appState.config?.contactsExcelPath ??
    appState.preferences?.contactsExcelPath ??
    "Nessun file selezionato";
  $("screenshotPath").textContent =
    appState.config?.screenshotDirectory ?? "Gestito automaticamente";
  $("operationLogPath").textContent =
    appState.config?.operationLogPath ?? "Gestito automaticamente";
  $("keepAliveStatus").textContent =
    appState.sisterKeepAlive?.statusLabel === "active"
      ? `Attivo · ultimo controllo ${fmtTime(appState.sisterKeepAlive.checkedAt)}`
      : (appState.sisterKeepAlive?.message ?? "In attesa");
  $("configurationStatus").textContent = appState.configError
    ? "Da completare"
    : (appState.config?.configurationSource ?? "Pronta");
  $("configurationStatus").className =
    `status-pill ${appState.configError ? "is-error" : "is-complete"}`;
  $("startButton").disabled =
    appState.active ||
    Boolean(appState.streetRun?.active) ||
    Boolean(appState.configError) ||
    Boolean(appState.cloudError) ||
    Boolean(appState.lastError && appState.activeJobId && !completed);
  /* La fase decide cosa merita spazio: fermi si vede come partire, in
   * lavorazione si vede il lavoro. Il resto lo fa il foglio di stile. */
  const anyOperationActive = Boolean(
    appState.active || appState.streetRun?.active || appState.networkRun?.active ||
    appState.requestArchive?.active || appState.mandateArchive?.active || appState.stoppingAll,
  );
  lockSecondaryPageActions(anyOperationActive);
  document.body.dataset.fase =
    anyOperationActive
      ? "lavora"
      : appState.operationCompletion || completed
        ? "finita"
        : appState.lastError
          ? "attenzione"
          : "pronto";
  document.body.dataset.via =
    appState.streetRun?.active || appState.networkRun?.active ? "attiva" : "no";
  /* Il titolo della pagina dice in che momento sei: chiedere «cosa vuoi fare?»
   * mentre il programma sta già lavorando è la domanda sbagliata. */
  const intestazioni = {
    pronto: ["Cosa vuoi fare?", "Ti guiderò un passaggio alla volta. Se qualcosa non va, troverai qui la soluzione."],
    lavora: ["Sto lavorando", "Non serve che tu faccia niente: se avrò bisogno di te, te lo chiedo qui."],
    finita: ["Fatto", "L'import è andato a buon fine. Trovi tutto in Cronologia, oppure puoi iniziarne un altro."],
    attenzione: ["Serve una tua mano", "Mi sono fermato per non fare danni. Qui sotto c'è cosa è successo e come si riparte."],
  };
  const [titolo, sottotitolo] = intestazioni[document.body.dataset.fase] ?? intestazioni.pronto;
  $("workspaceTitle").textContent = titolo;
  $("workspaceSubtitle").textContent = sottotitolo;
  $("runBadge").className =
    `status-pill ${anyOperationActive ? "is-running" : appState.operationCompletion || completed ? "is-complete" : appState.lastError ? "is-error" : "is-idle"}`;
  $("runBadge").innerHTML =
    `<span></span>${anyOperationActive ? "In lavorazione" : appState.operationCompletion || completed ? "Completata" : appState.lastError ? "Serve attenzione" : "Pronto"}`;
  $("operationTitle").textContent = appState.active
    ? guide(appState.currentStep).label
    : appState.operationCompletion
      ? appState.operationCompletion.title
      : completed
      ? "Import completato"
      : "Percorso completo";
  if (Array.isArray(appState.connections?.checks)) checks = appState.connections.checks;
  $("lastCheckLabel").textContent = appState.connections?.checking
    ? "Aggiornamento…"
    : appState.connections?.checkedAt
      ? `Aggiornato alle ${fmtTime(appState.connections.checkedAt)}`
      : "Controllo automatico in attesa";
  renderChecks();
  renderSteps();
  renderActivityMode();
  renderAction();
  renderJobs();
  renderCompletedImports();
  renderRequestArchive();
  renderMandateArchive();
  renderLastRun();
  renderActivity();
  renderDiagnosticErrors();
  renderStreetRun();
  renderStreetRegistry();
  renderNetworkRun();
  renderFiltriRete();
  renderReview();
  renderSoftwareUpdate();
  renderStopAll();
  renderCommandMonitor();
  renderRetryMonitor();
  renderRunControls();
}
async function runChecks() {
  const button = $("checkButton");
  if (button) button.disabled = true;
  $("lastCheckLabel").textContent = "Sto controllando…";
  try {
    checks = await window.propertyWorker.runChecks();
    const ok = checks.every((x) => x.ok);
    $("lastCheckLabel").textContent = ok
      ? "Tutto pronto"
      : "Controlla gli elementi rossi";
    renderChecks();
    toast(
      ok ? "Tutto pronto per partire" : "Ci sono collegamenti da sistemare",
    );
    return checks;
  } finally {
    if (button) button.disabled = false;
  }
}
function openCancel(jobId) {
  if (!jobId) return;
  pendingCancelJobId = jobId;
  cancelInFlight = false;
  const d = $("cancelProcessDialog");
  d.querySelectorAll("button").forEach((b) => (b.disabled = false));
  d.showModal();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || (target.form && target.type === "submit")) return;
  event.preventDefault();

  /* I bottoni dei filtri non sono comandi: non chiedono niente al processo
   * principale, quindi non passano dal monitor delle operazioni. */
  if (target.dataset.netChip) {
    apriFiltroRete(target.dataset.netChip);
    return;
  }
  if (target.dataset.netClear) {
    svuotaFiltroRete(target.dataset.netClear);
    renderFiltriRete();
    return;
  }
  if (target.dataset.netInfo) {
    const spiegazione = document.querySelector(`[data-net-explain="${target.dataset.netInfo}"]`);
    if (spiegazione) {
      spiegazione.hidden = !spiegazione.hidden;
      target.setAttribute("aria-expanded", String(!spiegazione.hidden));
      adeguaAltezzaCarosello();
    }
    return;
  }

  const command = commandIdentity(target);
  try {
    await executeButtonCommand(target, command, async () => {
      if (target.id === "stopAllButton") {
        if (
          !window.confirm(
            "Fermare tutte le operazioni? Le lavorazioni in corso verranno arrestate in sicurezza e potrai avviarne subito di nuove.",
          )
        )
          return COMMAND_CANCELLED;
        return window.propertyWorker.stopAll();
      }
      if (target.id === "stopAfterNextImportButton")
        return window.propertyWorker.setStopAfterNextImport(
          !appState?.stopAfterNextImport,
        );
      if (target.id === "softwareUpdateCancel")
        return window.propertyWorker.cancelUpdateDownload();
      if (target.dataset.updateAction === "check")
        return window.propertyWorker.checkUpdate();
      if (target.dataset.updateAction === "download")
        return window.propertyWorker.downloadUpdate();
      if (target.dataset.updateAction === "install")
        return window.propertyWorker.installUpdate();
      if (target.dataset.runSlideTarget) {
        setRunSlide(target.dataset.runSlideTarget);
        return true;
      }
      if (target.dataset.carouselDirection) {
        moveRunSlide(target.dataset.carouselDirection);
        return true;
      }
      if (target.dataset.scroll) {
        markActiveNav(target.dataset.scroll);
        goTo(target.dataset.scroll);
        return true;
      }
      if (target.dataset.action === "toggle-checks") {
        const grid = $("checksGrid");
        const aperto = grid.classList.toggle("is-hidden");
        target.setAttribute("aria-expanded", String(!aperto));
        target.textContent = aperto ? "Dettagli" : "Nascondi dettagli";
        return;
      }
      if (target.dataset.activityMode) {
        renderActivityModeOptimistic(target.dataset.activityMode);
        return window.propertyWorker.savePreferences({ propertyActivityMode: target.dataset.activityMode });
      }
      if (target.dataset.mode) {
        selectedMode = target.dataset.mode;
        return window.propertyWorker.savePreferences({ mode: selectedMode });
      }
      if (target.id === "checkButton" || target.dataset.action === "checks")
        return runChecks();
      if (target.id === "chromeButton") {
        const result = await window.propertyWorker.openChrome();
        toast("Chrome di lavoro aperto");
        return result;
      }
      if (target.id === "chooseExcelButton") {
        const path = await window.propertyWorker.chooseExcel();
        if (path) toast("File Excel aggiornato");
        return path ?? COMMAND_CANCELLED;
      }
      if (target.id === "openOperationLogButton") {
        const filePath = appState?.config?.operationLogPath;
        if (!filePath)
          throw new Error("Percorso del registro operativo non disponibile");
        return window.propertyWorker.revealFile(filePath);
      }
      if (target.id === "startButton")
        return window.propertyWorker.startJob({
          mode: selectedMode,
          dryRun: $("dryRunToggle").checked,
        });
      if (target.id === "streetRunStart") {
        const street = $("streetRunInput").value.trim(),
          dryRun = $("dryRunToggle").checked;
        if (!street) throw new Error("Inserisci la via esatta");
        if (
          !dryRun &&
          !window.confirm(
            "La run reale interrogherà tutte le varianti esatte, applicando a ciascuna gli eventuali limiti civici; per ogni riga ricontrollerà il primo civico da Indirizzo e, al termine, importerà automaticamente immobili, proprietari e attività nel gestionale. Continuare?",
          )
        )
          return COMMAND_CANCELLED;
        return window.propertyWorker.startStreetRun({
          street,
          resume: false,
          dryRun,
          filters: {
            residentialOnly: $("streetResidentialOnly").checked,
            floorMode: $("streetFloorMode").value,
            floorValue: nullableNumber($("streetFloorValue").value),
            minCivicNumber: nullableNumber($("streetMinCivic").value),
            maxCivicNumber: nullableNumber($("streetMaxCivic").value),
          },
        });
      }
      if (target.id === "streetRegistryRefresh")
        return window.propertyWorker.refreshStreetRegistry();
      if (target.id === "streetRegistryStart") {
        const prossima = appState?.streetRegistry?.queue?.[0];
        if (!prossima) throw new Error("Nessuna via in attesa nel registro");
        /* Il registro lavora solo run reali: la conferma dice cosa sta per
         * succedere davvero, compreso l'import automatico finale. */
        if (!window.confirm(
          `Il registro assegnerà ${prossima.canonical_name} a questo Worker e avvierà la run reale: `
          + "tutte le varianti esatte con gli eventuali limiti civici applicati a ciascuna, con import automatico nel gestionale al termine. Continuare?",
        )) return COMMAND_CANCELLED;
        return window.propertyWorker.startRegistryStreetRun({
          filters: {
            residentialOnly: $("streetResidentialOnly").checked,
            floorMode: $("streetFloorMode").value,
            floorValue: nullableNumber($("streetFloorValue").value),
            minCivicNumber: nullableNumber($("streetMinCivic").value),
            maxCivicNumber: nullableNumber($("streetMaxCivic").value),
          },
        });
      }
      if (target.id === "streetRunCancel")
        return window.propertyWorker.cancelStreetRun();
      if (target.id === "networkRegistryRefresh")
        return window.propertyWorker.refreshStreetRegistry({ zoneId: $("networkRegistryZone").value || null });
      if (target.id === "networkRegistryStart") {
        const claim = appState?.streetRegistry?.claim,
          next = claim ?? appState?.streetRegistry?.queue?.[0];
        if (!next) throw new Error("Nessuna via disponibile nel registro");
        if (!window.confirm(
          `${claim ? "Riprendere" : "Avviare"} Rete proprietari da ${next.canonical_name}? `
          + "Il Worker continuerà con le vie successive, dal centro verso l’esterno, e importerà ogni via nel CRM prima di passare alla prossima.",
        )) return COMMAND_CANCELLED;
        return window.propertyWorker.startNetworkRun({
          zoneId: $("networkRegistryZone").value || null,
          filters: {
            residentialOnly: $("networkStreetResidentialOnly").checked,
            floorMode: $("networkStreetFloorMode").value,
            floorValue: nullableNumber($("networkStreetFloorValue").value),
            minCivicNumber: nullableNumber($("networkStreetMinCivic").value),
            maxCivicNumber: nullableNumber($("networkStreetMaxCivic").value),
          },
        });
      }
      if (target.id === "networkRegistryPause")
        return window.propertyWorker.cancelNetworkRun();
      if (target.id === "networkFilterReset") {
        for (const gruppo of Object.keys(FILTRI_RETE)) svuotaFiltroRete(gruppo);
        renderFiltriRete();
        return true;
      }
      if (target.id === "networkRunStart") {
        const keepAcquisition = $("dryRunToggle").checked;
        if (
          !keepAcquisition &&
          !window.confirm(
            "La rete attraverserà nominativi, immobili e comproprietari fino all'obiettivo. Al termine importerà automaticamente solo gli immobili nuovi o verificati con identità completa; le schede già esistenti resteranno in sola lettura. Continuare?",
          )
        )
          return COMMAND_CANCELLED;
        return window.propertyWorker.startNetworkRun({
          resume: false,
          settings: {
            targetProperties: numeroOMancante($("networkTargetProperties").value),
            maxDepth: numeroOMancante($("networkMaxDepth").value),
            maxPeople: numeroOMancante($("networkMaxPeople").value),
            seedCount: numeroOMancante($("networkSeedCount").value),
            minSharePercentage: numeroOMancante($("networkMinShare").value),
            existingPropertyPolicy: $("networkIncludeExisting").checked ? "include_existing" : "new_only",
            residentialOnly: $("networkResidentialOnly").checked,
            floorMode: $("networkFloorMode").value,
            floorValue: nullableNumber($("networkFloorValue").value),
            minOwnerAge: nullableNumber($("networkMinOwnerAge").value),
            maxOwnerAge: nullableNumber($("networkMaxOwnerAge").value),
            minOwnerCount: nullableNumber($("networkMinOwnerCount").value),
            maxOwnerCount: nullableNumber($("networkMaxOwnerCount").value),
            minCivicNumber: nullableNumber($("networkMinCivic").value),
            maxCivicNumber: nullableNumber($("networkMaxCivic").value),
          },
        });
      }
      if (target.id === "networkRunCancel")
        return window.propertyWorker.cancelNetworkRun();
      if (target.id === "streetRunAbandon") {
        if (
          !window.confirm(
            "Interrompere questa run via? L’operazione corrente verrà chiusa in sicurezza e potrai avviare subito una nuova acquisizione.",
          )
        )
          return COMMAND_CANCELLED;
        return window.propertyWorker.abandonStreetRun();
      }
      if (target.id === "requestArchiveStart")
        return window.propertyWorker.startRequestArchiveImport(
          target.dataset.resumeRun || undefined,
        );
      if (target.id === "requestArchiveCancel")
        return window.propertyWorker.cancelRequestArchiveImport();
      if (target.id === "requestArchiveNew")
        return window.propertyWorker.startRequestArchiveImport();
      if (target.id === "mandateArchiveStart")
        return window.propertyWorker.startMandateArchiveImport(
          target.dataset.resumeRun || undefined,
        );
      if (target.id === "mandateArchiveCancel")
        return window.propertyWorker.cancelMandateArchiveImport();
      if (target.id === "mandateArchiveNew")
        return window.propertyWorker.startMandateArchiveImport();
      if (target.dataset.action === "toggle-auto-retry") {
        const enabling = appState.autoRetryEnabled === false,
          result = await window.propertyWorker.setAutoRetryEnabled(enabling);
        toast(
          enabling
            ? "Riprova automatico riattivato"
            : "Riprova automatico fermato",
        );
        return result;
      }
      if (target.dataset.action === "pause-street-run")
        return window.propertyWorker.cancelStreetRun();
      if (target.dataset.action === "pause-network-run")
        return window.propertyWorker.cancelNetworkRun();
      if (target.dataset.action === "cancel-request-sync")
        return window.propertyWorker.cancelRequestArchiveImport();
      if (target.dataset.action === "cancel-mandate-sync")
        return window.propertyWorker.cancelMandateArchiveImport();
      if (target.dataset.action === "pause")
        return window.propertyWorker.pauseJob();
      if (target.dataset.action === "reanalyze-current" && appState.activeJobId && target.dataset.propertyId) {
        if (!window.confirm("Rianalizzare l'immobile corrente? Controllerò nuovamente nominativi, immobile, attività e comproprietari, senza duplicare ciò che esiste già.")) return COMMAND_CANCELLED;
        return window.propertyWorker.reanalyzeProperty({
          jobId: appState.activeJobId,
          propertyId: target.dataset.propertyId,
        });
      }
      if (target.dataset.skipProperty && target.dataset.jobId) {
        const result = await window.propertyWorker.skipProperty({
          jobId: target.dataset.jobId,
          propertyId: target.dataset.skipProperty,
        });
        toast(
          result?.pending
            ? "Skip richiesto: concludo in sicurezza il passaggio corrente"
            : "Immobile saltato: continuo con il successivo",
        );
        return result;
      }
      if (target.id === "completedImportsLoadMore")
        return window.propertyWorker.loadMoreCompleted();
      if (target.dataset.completedSession) {
        const detail = await window.propertyWorker.getJobDetails(
            target.dataset.completedSession,
          ),
          job = detail.job,
          place =
            [job.municipality, job.street, job.civic_number]
              .filter(Boolean)
              .join(" · ") || `Import ${job.id.slice(0, 8)}`,
          stats = completedSessionStats(detail),
          skipText = stats.skippedProperties
            ? ` · ${stats.skippedProperties} immobili e ${stats.skippedPeople} nominativi saltati`
            : "";
        $("completedImportDialogTitle").textContent = place;
        $("completedImportDialogMeta").textContent =
          `Concluso ${fmtDate(job.completed_at ?? job.updated_at)} · ${stats.completedProperties} immobili completati${skipText}`;
        $("completedImportDialogContent").innerHTML =
          completedPropertyCards(detail);
        $("completedImportDialog").showModal();
        return true;
      }
      if (target.dataset.action === "close-completed-session") {
        $("completedImportDialog").close();
        return true;
      }
      if (target.dataset.action === "resume-current" && appState.activeJobId)
        return window.propertyWorker.resumeJob(appState.activeJobId);
      if (target.dataset.resumeJob) {
        await openImportDialog(target.dataset.resumeJob);
        return true;
      }
      if (target.dataset.importActivity) {
        importActivityMode = target.dataset.importActivity;
        markImportActivity();
        return true;
      }
      if (target.dataset.importDialog === "close") {
        $("importDialog").close();
        importJobId = null;
        return true;
      }
      if (target.dataset.importDialog === "confirm") {
        const jobId = importJobId;
        if (!jobId) return true;
        $("importDialog").close();
        importJobId = null;
        return window.propertyWorker.resumeJob({ jobId, activityMode: importActivityMode ?? undefined });
      }
      if (target.dataset.fixJob) return loadResolution(target.dataset.fixJob);
      if (target.dataset.action === "open-corrections" && appState.activeJobId)
        return loadResolution(appState.activeJobId);
      if (target.dataset.action === "close-corrections") {
        $("manualCorrectionPanel").classList.add("is-hidden");
        return true;
      }
      if (target.dataset.removeProperty) {
        pendingPropertyRemovalId = target.dataset.removeProperty;
        renderCorrections();
        target
          .closest(".manual-property-card")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return true;
      }
      if (target.hasAttribute("data-cancel-property-removal")) {
        pendingPropertyRemovalId = null;
        renderCorrections();
        return true;
      }
      if (
        target.dataset.confirmPropertyRemoval &&
        resolutionJobId &&
        !propertyRemovalInFlight
      ) {
        propertyRemovalInFlight = true;
        renderCorrections();
        try {
          await window.propertyWorker.removeJobProperty({
            jobId: resolutionJobId,
            propertyId: target.dataset.confirmPropertyRemoval,
          });
          pendingPropertyRemovalId = null;
          resolutionDetail =
            await window.propertyWorker.getJobDetails(resolutionJobId);
          toast("Immobile rimosso dalla lavorazione");
          return true;
        } finally {
          propertyRemovalInFlight = false;
          renderCorrections();
        }
      }
      if (target.dataset.action === "config") {
        goTo("settings");
        document.getElementById("advancedConfiguration").open = true;
        return true;
      }
      if (target.dataset.action === "open-review") {
        renderReview();
        return true;
      }
      if (target.dataset.reviewDecision && appState?.prompt) {
        $("acquisitionReviewDialog").close();
        return window.propertyWorker.answerPrompt({
          promptId: appState.prompt.id,
          decision: target.dataset.reviewDecision,
        });
      }
      if (target.dataset.prompt && appState?.prompt)
        return window.propertyWorker.answerPrompt({
          promptId: appState.prompt.id,
          decision:
            target.dataset.prompt === "confirm" &&
            ["acquisition", "manual"].includes(appState.prompt.kind)
              ? undefined
              : target.dataset.prompt,
        });
      if (target.dataset.detailJob) {
        const detail = await window.propertyWorker.getJobDetails(
          target.dataset.detailJob,
        );
        $("detailPanel").classList.remove("is-hidden");
        $("detailContent").innerHTML =
          `<p><b>${detail.properties.length}</b> immobili · <b>${detail.people.length}</b> proprietari · <b>${detail.ownerships.length}</b> quote</p>${detail.properties.map((p) => `<div class="detail-group"><b>${esc(p.address ?? p.cadastral_key)}</b><small>${esc(p.cadastral_key)} · ${esc(p.processing_status)}</small></div>`).join("")}`;
        goTo("detailPanel");
        return true;
      }
      if (target.dataset.action === "close-detail") {
        $("detailPanel").classList.add("is-hidden");
        return true;
      }
      if (target.dataset.cancelJob) {
        openCancel(target.dataset.cancelJob);
        return true;
      }
      if (target.dataset.action === "cancel-current") {
        openCancel(appState.activeJobId);
        return true;
      }
      if (target.dataset.cancelDialog === "close" && !cancelInFlight) {
        $("cancelProcessDialog").close();
        return true;
      }
      if (target.dataset.cancelDialog === "confirm" && pendingCancelJobId) {
        cancelInFlight = true;
        $("cancelProcessDialog")
          .querySelectorAll("button")
          .forEach((b) => (b.disabled = true));
        try {
          await window.propertyWorker.cancelJob(pendingCancelJobId);
          pendingCancelJobId = null;
          $("cancelProcessDialog").close();
          toast("Lavorazione annullata");
          return true;
        } finally {
          cancelInFlight = false;
          $("cancelProcessDialog")
            .querySelectorAll("button")
            .forEach((b) => (b.disabled = false));
        }
      }
      throw new Error(
        `Il pulsante “${command.label}” non ha un comando collegato`,
      );
    });
  } catch {}
});

$("manualCorrectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]'),
    command = {
      action: "save-manual-corrections",
      label: "Salva correzioni manuali",
    };
  try {
    await executeButtonCommand(button, command, async () => {
      if (!resolutionDetail || !resolutionJobId)
        throw new Error("Nessuna lavorazione disponibile da correggere");
      const properties = [
        ...event.currentTarget.querySelectorAll("[data-property-id]"),
      ].map((section) => ({
        id: section.dataset.propertyId,
        sheet: section.querySelector('[name="sheet"]').value,
        parcel: section.querySelector('[name="parcel"]').value,
        subaltern: section.querySelector('[name="subaltern"]').value,
        category: section.querySelector('[name="category"]').value,
        address: section.querySelector('[name="address"]').value || null,
        class: section.querySelector('[name="class"]').value || null,
        consistency:
          section.querySelector('[name="consistency"]').value || null,
        cadastralIncome: nullableNumber(
          section.querySelector('[name="cadastralIncome"]').value,
        ),
      }));
      const people = [
        ...event.currentTarget.querySelectorAll("[data-person-id]"),
      ].map((section) => ({
        id: section.dataset.personId,
        ownershipId: section.dataset.ownershipId,
        fullName: section.querySelector('[name="fullName"]').value,
        taxCode: section.querySelector('[name="taxCode"]').value || null,
        birthPlace: section.querySelector('[name="birthPlace"]').value || null,
        birthProvince:
          section.querySelector('[name="birthProvince"]').value || null,
        birthDate: section.querySelector('[name="birthDate"]').value || null,
        shareOriginal: section.querySelector('[name="shareOriginal"]').value,
        sharePercentage: nullableNumber(
          section.querySelector('[name="sharePercentage"]').value,
        ),
      }));
      await window.propertyWorker.saveManualCorrections({
        jobId: resolutionJobId,
        properties,
        people,
      });
      $("manualCorrectionPanel").classList.add("is-hidden");
      toast("Correzioni salvate. Ora puoi riprendere il lavoro.");
      return true;
    });
  } catch {}
});
$("configurationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  /* currentTarget viene azzerato dal browser appena l'handler cede il
   * controllo a una Promise. Conserviamo il form prima del primo await. */
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]'),
    command = { action: "save-configuration", label: "Salva configurazione" };
  try {
    await executeButtonCommand(button, command, async () => {
      const data = new FormData(form);
      await window.propertyWorker.saveInternalConfiguration(
        Object.fromEntries(data),
      );
      form.querySelector('[name="serviceRoleKey"]').value = "";
      toast("Configurazione salvata e protetta");
      return true;
    });
  } catch {}
});
/* La modalita di prova e una regola della run, non della tipologia: si salva
 * nelle preferenze e vale per quella che lanci. */
$("dryRunToggle").addEventListener("change", async (event) => {
  const toggle = event.currentTarget;
  renderStreetRun();
  try {
    await window.propertyWorker.savePreferences({ keepAcquisition: toggle.checked });
  } catch (error) {
    toggle.checked = !toggle.checked;
    renderStreetRun();
    toast(error?.message ?? String(error));
  }
});
$("networkFloorMode").addEventListener("change", () => {
  $("networkFloorValue").disabled = $("networkFloorMode").value === "any";
  if ($("networkFloorMode").value !== "any") $("networkFloorValue").focus();
  else $("networkFloorValue").value = "";
  renderFiltriRete();
});
$("streetFloorMode").addEventListener("change", () => {
  $("streetFloorValue").disabled = $("streetFloorMode").value === "any";
  if ($("streetFloorMode").value !== "any") $("streetFloorValue").focus();
  else $("streetFloorValue").value = "";
});
$("networkStreetFloorMode").addEventListener("change", () => {
  $("networkStreetFloorValue").disabled = $("networkStreetFloorMode").value === "any";
  if ($("networkStreetFloorMode").value !== "any") $("networkStreetFloorValue").focus();
  else $("networkStreetFloorValue").value = "";
});
$("networkRegistryZone").addEventListener("change", async () => {
  await window.propertyWorker.refreshStreetRegistry({ zoneId: $("networkRegistryZone").value || null });
});

/* Il bottone si accende mentre scrivi, non al prossimo disegno della pagina:
 * e' il riscontro che dice «questo filtro adesso agisce». */
$("networkPanels").addEventListener("input", renderFiltriRete);
$("networkPanels").addEventListener("change", renderFiltriRete);

window.propertyWorker.onStreetRunProgress((progress) => {
  if (!appState) return;
  appState.streetRun = { ...(appState.streetRun ?? {}), progress };
  renderStreetRunInternalProgress(progress);
  renderCommandMonitor();
  renderSteps();
});
window.propertyWorker.onTransientUpdate((update) => {
  if (!appState || !update) return;
  let renderOperation = false;
  if (Object.prototype.hasOwnProperty.call(update, "propertyProgress")) {
    appState.propertyProgress = update.propertyProgress;
    renderSteps();
    renderAction();
    enhanceActionPanel();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "retryMonitor")) {
    appState.retryMonitor = update.retryMonitor;
    renderRetryMonitor();
  }
  if (Object.prototype.hasOwnProperty.call(update, "requestImportProgress")) {
    appState.requestArchive = { ...(appState.requestArchive ?? {}), progress: update.requestImportProgress };
    renderRequestArchive();
    renderSteps();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "mandateImportProgress")) {
    appState.mandateArchive = { ...(appState.mandateArchive ?? {}), progress: update.mandateImportProgress };
    renderMandateArchive();
    renderSteps();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "networkRunProgress")) {
    appState.networkRun = { ...(appState.networkRun ?? {}), progress: update.networkRunProgress };
    renderNetworkRun();
    renderSteps();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "streetRunCheckpoint")) {
    appState.streetRun = { ...(appState.streetRun ?? {}), checkpoint: update.streetRunCheckpoint };
    renderStreetRun();
    renderSteps();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "networkRunCheckpoint")) {
    appState.networkRun = { ...(appState.networkRun ?? {}), checkpoint: update.networkRunCheckpoint };
    renderNetworkRun();
    renderSteps();
    renderOperation = true;
  }
  if (Object.prototype.hasOwnProperty.call(update, "sisterKeepAlive")) {
    appState.sisterKeepAlive = update.sisterKeepAlive;
    $("keepAliveStatus").textContent = update.sisterKeepAlive?.statusLabel === "active"
      ? `Attivo · ultimo controllo ${fmtTime(update.sisterKeepAlive.checkedAt)}`
      : (update.sisterKeepAlive?.message ?? "In attesa");
    renderChecks();
  }
  if (Object.prototype.hasOwnProperty.call(update, "connections")) {
    appState.connections = update.connections;
    checks = Array.isArray(update.connections?.checks) ? update.connections.checks : [];
    $("lastCheckLabel").textContent = update.connections?.checking
      ? "Aggiornamento…"
      : update.connections?.checkedAt
        ? `Aggiornato alle ${fmtTime(update.connections.checkedAt)}`
        : "Controllo automatico in attesa";
    renderChecks();
  }
  if (update.activityItem) {
    const items = appState.activity ?? [];
    if (items[0]?.at !== update.activityItem.at || items[0]?.message !== update.activityItem.message) {
      appState.activity = [update.activityItem, ...items].slice(0, 300);
    }
    renderActivity();
  }
  if (renderOperation) renderCommandMonitor();
});
window.propertyWorker.onState(async (state) => {
  appState = state;
  render();
  if (
    state.lastError &&
    state.activeJobId &&
    resolutionJobId !== state.activeJobId
  ) {
    try {
      await loadResolution(state.activeJobId, false);
    } catch {
      resolutionDetail = null;
    }
  }
});
setRunSlide(selectedRunSlide);
window.propertyWorker
  .getState()
  .then(async (state) => {
    appState = state;
    render();
    if (state.lastError && state.activeJobId)
      try {
        await loadResolution(state.activeJobId, false);
      } catch {
        resolutionDetail = null;
      }
  })
  .catch((e) => toast(e.message ?? String(e)));
