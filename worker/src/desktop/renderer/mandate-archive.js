document.getElementById("mandateArchiveStart").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await window.propertyWorker.startMandateArchiveImport(button.dataset.resumeRun || undefined);
  } catch (error) {
    toast(error.message ?? String(error));
  }
});

document.getElementById("mandateArchiveCancel").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    await window.propertyWorker.cancelMandateArchiveImport();
  } catch (error) {
    toast(error.message ?? String(error));
  }
});

window.propertyWorker.onState(state => {
  if (state.mandateArchive?.active) {
    document.getElementById("startButton").disabled = true;
    document.getElementById("requestArchiveStart").disabled = true;
  }
});
