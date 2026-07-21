const STEPS = [
  "ready", "sister_results_acquired", "properties_extracted", "owners_extracted", "data_normalized",
  "person_searched", "person_created_or_updated", "property_searched", "property_created_or_updated",
  "activity_created", "contacts_matched", "owners_linked", "verified", "completed",
];

const LABELS = {
  ready: "Preparazione", sister_results_acquired: "Risultati SISTER", properties_extracted: "Immobili estratti",
  owners_extracted: "Proprietari estratti", data_normalized: "Dati normalizzati", contacts_matched: "Recapiti Excel abbinati",
  person_searched: "Ricerca nominativi", person_created_or_updated: "Nominativi sincronizzati",
  property_searched: "Immobili del nominativo", property_created_or_updated: "Immobili sincronizzati",
  activity_created: "Attività da eseguire",
  owners_linked: "Comproprietari collegati", verified: "Verifica finale", completed: "Completato",
};

const ERROR_STATES = new Set(["needs_review", "session_expired", "portal_error", "data_incomplete", "failed"]);
let appState = null;
let checks = [];
let selectedMode = "assisted";
let toastTimer = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const time = (value) => value ? new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const dateTime = (value) => value ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3200);
}

function renderChecks() {
  const wanted = [
    ["chrome", "Chrome"], ["sister", "SISTER"], ["crm", "Gestionale"], ["excel", "Excel"], ["supabase", "Supabase"],
  ];
  $("checksGrid").innerHTML = wanted.map(([id, label]) => {
    const keepAlive = appState?.sisterKeepAlive;
    const keepAliveResult = id === "sister" && keepAlive?.statusLabel !== "waiting" && keepAlive?.statusLabel !== "disabled"
      ? {
          ok: keepAlive.ok,
          detail: keepAlive.ok
            ? `Sessione mantenuta · ${time(keepAlive.checkedAt)}`
            : keepAlive.message,
        }
      : null;
    const result = keepAliveResult ?? checks.find((item) => item.id === id);
    const stateClass = result ? (result.ok ? "is-ok" : "is-error") : "is-idle";
    return `<div class="check-item ${stateClass}"><span></span><div><b>${label}</b><small title="${escapeHtml(result?.detail ?? "Da controllare")}">${escapeHtml(result?.detail ?? "Da controllare")}</small></div></div>`;
  }).join("");
}

function renderSteps() {
  const current = appState?.currentStep ?? appState?.jobs?.find((job) => job.id === appState.activeJobId)?.current_step ?? "ready";
  const currentIndex = Math.max(0, STEPS.indexOf(current));
  const complete = current === "completed";
  const percent = complete ? 100 : Math.round((currentIndex / (STEPS.length - 1)) * 100);
  $("progressPercent").textContent = `${percent}%`;
  $("progressBar").style.width = `${percent}%`;
  $("workflowSteps").innerHTML = STEPS.map((step, index) => {
    const status = complete || index < currentIndex ? "is-done" : index === currentIndex && appState?.active ? "is-current" : "";
    return `<li class="workflow-step ${status}"><span class="index">${String(index + 1).padStart(2, "0")}</span><b>${LABELS[step]}</b><span class="state"></span></li>`;
  }).join("");
}

function promptButtons(prompt) {
  if (prompt.kind === "decision") return `
    <button class="button button-light" data-prompt="confirm">Conferma</button>
    <button class="button button-outline" data-prompt="skip">Salta</button>
    <button class="button button-outline" data-prompt="manual">Modifica manualmente</button>
    <button class="button danger" data-prompt="review">Da verificare</button>`;
  return `<button class="button button-light" data-prompt="confirm">${prompt.kind === "acquisition" ? "Acquisisci risultati" : "Ho terminato"}</button>`;
}

function renderAction() {
  const panel = $("actionPanel");
  if (appState?.configError) {
    panel.innerHTML = `<div class="action-number">!</div><div class="action-copy"><p class="kicker">Prima configurazione</p><h3>Collega il file worker/.env</h3><p>Seleziona il file locale di configurazione. Il suo contenuto resterà nel processo protetto dell’app.</p></div><div class="action-buttons"><button class="button button-light" data-action="config">Vai alla configurazione</button></div>`;
    return;
  }
  if (appState?.prompt) {
    panel.classList.remove("is-empty");
    panel.innerHTML = `<div class="action-number">!</div><div class="action-copy"><p class="kicker">Richiede la tua attenzione</p><h3>${escapeHtml(appState.prompt.title)}</h3><p>${escapeHtml(appState.prompt.summary)}</p></div><div class="action-buttons">${promptButtons(appState.prompt)}</div>`;
    return;
  }
  if (appState?.lastError) {
    const job = appState.jobs?.find((item) => item.id === appState.activeJobId);
    const completedLabel = LABELS[job?.last_completed_step] ?? "Preparazione";
    const completedIndex = STEPS.indexOf(job?.last_completed_step);
    const nextLabel = LABELS[STEPS[Math.min(Math.max(0, completedIndex + 1), STEPS.length - 1)]] ?? "passaggio successivo";
    panel.innerHTML = `<div class="action-number">×</div><div class="action-copy"><p class="kicker">Avanzamento salvato</p><h3>La lavorazione si è fermata</h3><p>${escapeHtml(appState.lastError)}\nUltimo passaggio completato: ${escapeHtml(completedLabel)}. La ripresa partirà da ${escapeHtml(nextLabel)}.</p></div><div class="action-buttons">${appState.activeJobId && !appState.active ? `<button class="button button-light" data-action="resume-current">Riprendi lavorazione</button>` : ""}<button class="button button-outline" data-action="checks">Controlla sistema</button></div>`;
    return;
  }
  if (appState?.active) {
    panel.innerHTML = `<div class="action-number">→</div><div class="action-copy"><p class="kicker">Worker in esecuzione</p><h3>${escapeHtml(LABELS[appState.currentStep] ?? "Elaborazione in corso")}</h3><p>Puoi continuare a lavorare soltanto quando compare una richiesta di conferma. L’avanzamento viene salvato dopo ogni passaggio.</p></div><div class="action-buttons"><button class="button danger" data-action="pause">Metti in pausa</button></div>`;
    return;
  }
  panel.innerHTML = `<div class="action-number">01</div><div class="action-copy"><p class="kicker">Prossima azione</p><h3>Prepara le due schede</h3><p>Apri SISTER e il gestionale nel Chrome dedicato, completa gli accessi e porta SISTER ai risultati.</p></div><div class="action-buttons"><button class="button button-light" data-action="checks">Verifica adesso</button></div>`;
}

function jobTone(status) {
  if (status === "completed") return "is-completed";
  if (ERROR_STATES.has(status)) return "is-error";
  if (status === "running") return "is-running";
  return "";
}

function renderJobs() {
  const jobs = appState?.jobs ?? [];
  $("jobCount").textContent = jobs.length;
  $("jobsList").innerHTML = jobs.length ? jobs.map((job) => {
    const canResume = job.status !== "completed" && (!appState.active || job.id !== appState.activeJobId);
    const place = [job.municipality, job.street, job.civic_number].filter(Boolean).join(" · ") || `Job ${job.id.slice(0, 8)}`;
    const issue = job.error_message ? `<br><span class="job-issue" title="${escapeHtml(job.error_message)}">${escapeHtml(job.error_message)}</span>` : "";
    return `<article class="job-item ${jobTone(job.status)}"><span></span><div><b title="${escapeHtml(place)}">${escapeHtml(place)}</b><small>${escapeHtml(job.mode)} · ${escapeHtml(LABELS[job.last_completed_step] ?? "Non avviato")}<br>${dateTime(job.updated_at ?? job.created_at)}${issue}</small></div><div class="job-actions"><button class="text-button" data-detail-job="${job.id}">Dettagli</button>${canResume ? `<button class="text-button" data-resume-job="${job.id}">Riprendi</button>` : ""}</div></article>`;
  }).join("") : `<p class="empty-message">Nessuna lavorazione disponibile.</p>`;
}

function renderActivity() {
  const items = appState?.activity ?? [];
  $("activityList").innerHTML = items.length ? items.map((item) => `<div class="activity-item is-${item.tone}"><time>${time(item.at)}</time><i></i><p>${escapeHtml(item.message)}</p></div>`).join("") : `<p class="empty-message">Le attività compariranno qui.</p>`;
}

function render() {
  if (!appState) return;
  selectedMode = appState.preferences?.mode ?? selectedMode;
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("is-selected", button.dataset.mode === selectedMode));
  $("dryRunToggle").checked = appState.preferences?.dryRun !== false;
  $("versionLabel").textContent = `v${appState.version}`;
  $("environmentPath").textContent = appState.config?.environmentFilePath ?? appState.preferences?.environmentFilePath ?? "File worker/.env non selezionato";
  $("excelPath").textContent = appState.config?.contactsExcelPath ?? appState.preferences?.contactsExcelPath ?? "Percorso non disponibile";
  $("screenshotPath").textContent = appState.config?.screenshotDirectory ?? "Percorso non disponibile";
  $("keepAliveStatus").textContent = appState.sisterKeepAlive?.statusLabel === "active"
    ? `Attivo · ultimo controllo ${time(appState.sisterKeepAlive.checkedAt)}`
    : appState.sisterKeepAlive?.message ?? "In attesa del primo controllo";
  $("startButton").disabled = appState.active || Boolean(appState.configError) || Boolean(appState.lastError && appState.activeJobId);
  $("pauseButton").disabled = !appState.active;
  $("runBadge").className = `run-badge ${appState.active ? "is-running" : appState.lastError ? "is-error" : appState.currentStep === "completed" ? "is-complete" : "is-idle"}`;
  $("runBadge").innerHTML = `<span></span>${appState.active ? "In esecuzione" : appState.lastError ? "Interrotta, riprendibile" : appState.currentStep === "completed" ? "Completato" : "In attesa"}`;
  $("operationTitle").textContent = appState.active ? (LABELS[appState.currentStep] ?? "Lavorazione in corso") : appState.lastError ? "Lavorazione interrotta · avanzamento salvato" : "Pronto per una nuova acquisizione";
  renderChecks(); renderSteps(); renderAction(); renderJobs(); renderActivity();
}

async function runChecks() {
  $("checkButton").disabled = true;
  $("lastCheckLabel").textContent = "Controllo in corso…";
  try {
    checks = await window.propertyWorker.runChecks();
    $("lastCheckLabel").textContent = checks.every((item) => item.ok) ? "Tutto pronto" : "Richiede attenzione";
    renderChecks();
    toast(checks.every((item) => item.ok) ? "Sistema pronto" : "Controlla gli elementi evidenziati");
  } catch (error) { toast(error.message ?? String(error)); }
  finally { $("checkButton").disabled = false; }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.dataset.mode) {
      selectedMode = target.dataset.mode;
      await window.propertyWorker.savePreferences({ mode: selectedMode });
    } else if (target.id === "checkButton" || target.id === "actionCheckButton" || target.dataset.action === "checks") await runChecks();
    else if (target.id === "chromeButton") { await window.propertyWorker.openChrome(); toast("Chrome dedicato avviato"); }
    else if (target.id === "chooseExcelButton") { const result = await window.propertyWorker.chooseExcel(); if (result) toast("File Excel aggiornato"); }
    else if (target.id === "chooseEnvironmentButton") { const result = await window.propertyWorker.chooseEnvironment(); if (result) toast("Configurazione locale aggiornata"); }
    else if (target.id === "startButton") await window.propertyWorker.startJob({ mode: selectedMode, dryRun: $("dryRunToggle").checked });
    else if (target.id === "pauseButton" || target.dataset.action === "pause") await window.propertyWorker.pauseJob();
    else if (target.dataset.action === "resume-current" && appState.activeJobId) await window.propertyWorker.resumeJob(appState.activeJobId);
    else if (target.dataset.action === "config") document.getElementById("settings")?.scrollIntoView({ behavior: "smooth" });
    else if (target.dataset.prompt) await window.propertyWorker.answerPrompt({ promptId: appState.prompt.id, decision: target.dataset.prompt === "confirm" && appState.prompt.kind !== "decision" ? undefined : target.dataset.prompt });
    else if (target.dataset.resumeJob) await window.propertyWorker.resumeJob(target.dataset.resumeJob);
    else if (target.dataset.detailJob) {
      const detail = await window.propertyWorker.getJobDetails(target.dataset.detailJob);
      $("detailPanel").classList.remove("is-hidden");
      const activities = detail.properties.reduce((total, property) => total + Object.keys(property.raw_payload?.worker_activities ?? {}).length, 0);
      const alternatives = Array.isArray(detail.job.error_details?.alternatives) ? detail.job.error_details.alternatives : [];
      const review = detail.job.error_message ? `<div class="detail-error"><b>Intervento richiesto</b><p>${escapeHtml(detail.job.error_message)}</p>${alternatives.length ? `<ul>${alternatives.map((item) => `<li>${escapeHtml(item.label ?? "Scheda cliente")} · ${escapeHtml(String(item.id ?? "").slice(-6))}</li>`).join("")}</ul>` : ""}</div>` : "";
      $("detailContent").innerHTML = `<div class="detail-metrics"><div><b>${detail.properties.length}</b><small>Immobili</small></div><div><b>${detail.people.length}</b><small>Nominativi</small></div><div><b>${detail.ownerships.length}</b><small>Quote</small></div><div><b>${activities}</b><small>Attività</small></div></div>${review}`;
      $("detailPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (target.dataset.scroll) document.getElementById(target.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
  } catch (error) { toast(error.message ?? String(error)); }
});

$("dryRunToggle").addEventListener("change", async (event) => {
  await window.propertyWorker.savePreferences({ dryRun: event.target.checked });
  toast(event.target.checked ? "Dry-run attivo" : "Attenzione: salvataggi reali abilitati");
});

window.propertyWorker.onState((state) => { appState = state; render(); });
window.propertyWorker.getState().then((state) => { appState = state; render(); }).catch((error) => toast(error.message ?? String(error)));
