document.getElementById("requestArchiveStart").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await window.propertyWorker.startRequestArchiveImport(button.dataset.resumeRun || undefined);
  } catch (error) {
    toast(error.message ?? String(error));
  }
});

document.getElementById("requestArchiveCancel").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    await window.propertyWorker.cancelRequestArchiveImport();
  } catch (error) {
    toast(error.message ?? String(error));
  }
});

window.propertyWorker.onState(state => {
  if (state.requestArchive?.active) {
    document.getElementById("startButton").disabled = true;
    document.getElementById("mandateArchiveStart").disabled = true;
  }
});
