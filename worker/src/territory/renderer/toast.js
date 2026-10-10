import { icon } from "./icons.js";

export function isBrowserWarning(message) {
  return /Chrome non raggiungibile|Chrome.*(?:non aperto|non disponibile)|ECONNREFUSED.*(?:9222|9223)|connectOverCDP/i.test(message);
}
/* Notifications live in the active dialog's top layer and never take focus. */
export function createToast(root, { openBrowser, canOpenBrowser }) {
  let timer = null, warningKey = null, remaining = 0, started = 0;
  const dismiss = () => { clearTimeout(timer); timer = null; root.hidden = true; };
  function schedule() {
    if (!remaining) return;
    started = Date.now(); timer = setTimeout(dismiss, remaining);
  }
  function pause() { if (timer) { clearTimeout(timer); timer = null; remaining = Math.max(1, remaining - (Date.now() - started)); } }
  root.addEventListener("mouseenter", pause);
  root.addEventListener("mouseleave", () => { if (!root.contains(document.activeElement)) schedule(); });
  root.addEventListener("focusin", pause);
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget) && !root.matches(":hover")) schedule(); });
  document.addEventListener("close", event => {
    if (event.target === root.parentElement) (document.querySelector("dialog[open]") || document.body).append(root);
  }, true);
  return {
    show(message, error = false, { deduplicate = false, runId = null } = {}) {
      const browser = isBrowserWarning(message), nextKey = `${error}:${message}`;
      if (deduplicate && nextKey === warningKey) return;
      if (deduplicate) warningKey = nextKey;
      dismiss();
      if (runId) root.dataset.run = runId;
      else delete root.dataset.run;
      root.dataset.tone = browser ? "warning" : error ? "error" : "info";
      root.classList.toggle("error", error && !browser);
      root.innerHTML = `${icon(browser ? "browser" : error ? "warning" : "info")}<div class="toast-copy"><p class="toast-message"></p>${browser && canOpenBrowser() ? '<button type="button" class="quiet" data-toast-browser>Apri Chrome di lavoro</button>' : ""}</div><button type="button" class="quiet toast-close" aria-label="Chiudi notifica">${icon("close")}</button>`;
      const text = root.querySelector(".toast-message");
      text.setAttribute("role", error ? "alert" : "status");
      text.textContent = browser ? "Chrome di lavoro non è raggiungibile. Aprilo e accedi a SISTER e Tecnocloud, poi riprendi l’operazione." : message;
      root.querySelector(".toast-close").onclick = dismiss;
      const action = root.querySelector("[data-toast-browser]");
      if (action) action.onclick = async () => { action.disabled = true; await openBrowser(); if (action.isConnected) action.disabled = false; };
      (document.querySelector("dialog[open]") || document.body).append(root);
      root.hidden = false;
      remaining = error ? 0 : 6000;
      schedule();
    },
    reset() { warningKey = null; }, dismiss,
  };
}
