/* Presentation follows acquired evidence, never an attempted or failed read. */
export function streetViewState(detail, activeRun) {
  const latest = detail.runs.at(-1);
  const paused = latest && ["paused", "failed"].includes(latest.state) ? latest : null;
  const hasInventory = Boolean(detail.units.length || detail.street.progress.complete || detail.runs.some(run => run.operation === "scan" && run.state === "completed"));
  const acquiring = activeRun?.operation === "scan" && activeRun.streetId === detail.street.id;
  return { hasInventory, paused, phase: hasInventory ? "populated" : acquiring ? "acquiring" : paused?.operation === "scan" ? "interrupted" : "unacquired" };
}
