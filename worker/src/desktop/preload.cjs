const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("propertyWorker", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  recordUiAction: (values) => ipcRenderer.invoke("desktop:record-ui-action", values),
  runChecks: () => ipcRenderer.invoke("desktop:run-checks"),
  openChrome: () => ipcRenderer.invoke("desktop:open-chrome"),
  chooseExcel: () => ipcRenderer.invoke("desktop:choose-excel"),
  chooseEnvironment: () => ipcRenderer.invoke("desktop:choose-environment"),
  savePreferences: (values) => ipcRenderer.invoke("desktop:save-preferences", values),
  saveInternalConfiguration: (values) => ipcRenderer.invoke("desktop:save-internal-configuration", values),
  startJob: (values) => ipcRenderer.invoke("desktop:start-job", values),
  setStopAfterNextImport: (enabled) => ipcRenderer.invoke("desktop:set-stop-after-next-import", enabled),
  startStreetRun: (values) => ipcRenderer.invoke("desktop:start-street-run", values),
  cancelStreetRun: () => ipcRenderer.invoke("desktop:cancel-street-run"),
  refreshStreetRegistry: () => ipcRenderer.invoke("desktop:refresh-street-registry"),
  startRegistryStreetRun: (values) => ipcRenderer.invoke("desktop:start-registry-street-run", values),
  startNetworkRun: (values) => ipcRenderer.invoke("desktop:start-network-run", values),
  cancelNetworkRun: () => ipcRenderer.invoke("desktop:cancel-network-run"),
  abandonStreetRun: () => ipcRenderer.invoke("desktop:abandon-street-run"),
  stopAll: () => ipcRenderer.invoke("desktop:stop-all"),
  startRequestArchiveImport: (runId) => ipcRenderer.invoke("desktop:start-request-archive-import", runId),
  cancelRequestArchiveImport: () => ipcRenderer.invoke("desktop:cancel-request-archive-import"),
  startMandateArchiveImport: (runId) => ipcRenderer.invoke("desktop:start-mandate-archive-import", runId),
  cancelMandateArchiveImport: () => ipcRenderer.invoke("desktop:cancel-mandate-archive-import"),
  resumeJob: (values) => ipcRenderer.invoke("desktop:resume-job", values),
  reanalyzeProperty: (values) => ipcRenderer.invoke("desktop:reanalyze-property", values),
  setAutoRetryEnabled: (enabled) => ipcRenderer.invoke("desktop:set-auto-retry-enabled", enabled),
  pauseJob: () => ipcRenderer.invoke("desktop:pause-job"),
  cancelJob: (jobId) => ipcRenderer.invoke("desktop:cancel-job", jobId),
  answerPrompt: (values) => ipcRenderer.invoke("desktop:answer-prompt", values),
  getJobDetails: (jobId) => ipcRenderer.invoke("desktop:get-job-details", jobId),
  skipProperty: (values) => ipcRenderer.invoke("desktop:skip-property", values),
  loadMoreCompleted: () => ipcRenderer.invoke("desktop:load-more-completed"),
  saveManualCorrections: (values) => ipcRenderer.invoke("desktop:save-manual-corrections", values),
  removeJobProperty: (values) => ipcRenderer.invoke("desktop:remove-job-property", values),
  revealFile: (filePath) => ipcRenderer.invoke("desktop:reveal-file", filePath),
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  cancelUpdateDownload: () => ipcRenderer.invoke("desktop:cancel-update-download"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("desktop:state", handler);
    return () => ipcRenderer.removeListener("desktop:state", handler);
  },
  onStreetRunProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("desktop:street-run-progress", handler);
    return () => ipcRenderer.removeListener("desktop:street-run-progress", handler);
  },
  onTransientUpdate: (listener) => {
    const handler = (_event, update) => listener(update);
    ipcRenderer.on("desktop:transient-update", handler);
    return () => ipcRenderer.removeListener("desktop:transient-update", handler);
  },
});
