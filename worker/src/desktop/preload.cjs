const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("propertyWorker", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  runChecks: () => ipcRenderer.invoke("desktop:run-checks"),
  openChrome: () => ipcRenderer.invoke("desktop:open-chrome"),
  chooseExcel: () => ipcRenderer.invoke("desktop:choose-excel"),
  chooseEnvironment: () => ipcRenderer.invoke("desktop:choose-environment"),
  savePreferences: (values) => ipcRenderer.invoke("desktop:save-preferences", values),
  saveInternalConfiguration: (values) => ipcRenderer.invoke("desktop:save-internal-configuration", values),
  startJob: (values) => ipcRenderer.invoke("desktop:start-job", values),
  resumeJob: (jobId) => ipcRenderer.invoke("desktop:resume-job", jobId),
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
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("desktop:state", handler);
    return () => ipcRenderer.removeListener("desktop:state", handler);
  },
});
