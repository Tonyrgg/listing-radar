import type { ImportV2Failure } from "./model.js";

/** A technical outage is not evidence that an acquired property is unworkable. */
export function isRecoverableImportFailure(failure: ImportV2Failure | null | undefined): boolean {
  return failure?.kind === "transient_portal"
    || failure?.kind === "global_portal"
    || failure?.kind === "cloud_unavailable";
}
