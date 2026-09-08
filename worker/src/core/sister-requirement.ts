const SISTER_WORKFLOW_STEPS = new Set([
  "ready",
  "sister_results_acquired",
  "properties_extracted",
  "owners_extracted",
]);

/** SISTER is no longer a runtime dependency after its acquisition is complete. */
export function stepRequiresSister(step: string | null | undefined): boolean {
  return !step || SISTER_WORKFLOW_STEPS.has(step);
}
