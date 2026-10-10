type AcquisitionRun = { operation: string; state: string };
type StreetEvidence = {
  street: { id: string; progress: { complete: boolean } };
  runs: AcquisitionRun[];
  units: unknown[];
};
export function streetViewState(detail: StreetEvidence, activeRun: { operation: string; streetId: string } | null | undefined): {
  hasInventory: boolean;
  paused: AcquisitionRun | null;
  phase: "populated" | "acquiring" | "interrupted" | "unacquired";
};
