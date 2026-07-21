const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("propertyWorker", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  runChecks: () => ipcRenderer.invoke("desktop:run-checks"),
  openChrome: () => ipcRenderer.invoke("desktop:open-chrome"),
  chooseExcel: () => ipcRenderer.invoke("desktop:choose-excel"),
  chooseEnvironment: () => ipcRenderer.invoke("desktop:choose-environment"),
  savePreferences: (values) => ipcRenderer.invoke("desktop:save-preferences", values),
  startJob: (values) => ipcRenderer.invoke("desktop:start-job", values),
  resumeJob: (jobId) => ipcRenderer.invoke("desktop:resume-job", jobId),
  pauseJob: () => ipcRenderer.invoke("desktop:pause-job"),
  cancelJob: (jobId) => ipcRenderer.invoke("desktop:cancel-job", jobId),
  answerPrompt: (values) => ipcRenderer.invoke("desktop:answer-prompt", values),
  getJobDetails: (jobId) => ipcRenderer.invoke("desktop:get-job-details", jobId),
  revealFile: (filePath) => ipcRenderer.invoke("desktop:reveal-file", filePath),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("desktop:state", handler);
    return () => ipcRenderer.removeListener("desktop:state", handler);
  },
});
