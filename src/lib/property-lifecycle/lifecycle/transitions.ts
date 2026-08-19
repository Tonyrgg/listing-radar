import type {
  AdapterHealthState,
  SourceStatus,
} from "@/lib/property-lifecycle/contracts/normalized-listing";

export type PublicationState = "ACTIVE" | "MISSING_PENDING" | "REMOVED" | "SOLD_MARKED";

export interface PublicationPresence {
  state: PublicationState;
  missingHealthyRunCount: number;
  missingSince: string | null;
  removedAt: string | null;
  sourceStatus: SourceStatus;
}

export type PublicationTransitionEvent =
  | "PUBLICATION_MISSING_PENDING"
  | "PUBLICATION_REMOVED"
  | "PUBLICATION_REAPPEARED"
  | "SOURCE_MARKED_SOLD"
  | "SOURCE_STATUS_CHANGED";

export interface PresenceEvaluationInput {
  current: PublicationPresence;
  healthState: AdapterHealthState;
  inventoryComplete: boolean;
  observedPresent: boolean;
  observedSourceStatus?: SourceStatus;
  observedAt: string;
  missingHealthyRunThreshold?: number;
}

export interface PresenceEvaluation {
  next: PublicationPresence;
  events: PublicationTransitionEvent[];
  absenceEvaluated: boolean;
}

export function canEvaluateAbsence(
  healthState: AdapterHealthState,
  inventoryComplete: boolean,
): boolean {
  return healthState === "HEALTHY" && inventoryComplete;
}

export function evaluatePublicationPresence(
  input: PresenceEvaluationInput,
): PresenceEvaluation {
  const threshold = Math.max(2, input.missingHealthyRunThreshold ?? 2);
  const sourceStatus = input.observedSourceStatus ?? input.current.sourceStatus;

  if (input.observedPresent) {
    if (sourceStatus === "SOLD") {
      return {
        next: {
          state: "SOLD_MARKED",
          sourceStatus,
          missingHealthyRunCount: 0,
          missingSince: null,
          removedAt: input.current.removedAt,
        },
        events: input.current.state === "SOLD_MARKED" ? [] : ["SOURCE_MARKED_SOLD"],
        absenceEvaluated: false,
      };
    }

    const events: PublicationTransitionEvent[] = [];
    if (input.current.state === "MISSING_PENDING" || input.current.state === "REMOVED") {
      events.push("PUBLICATION_REAPPEARED");
    }
    if (sourceStatus !== input.current.sourceStatus && sourceStatus !== "UNKNOWN") {
      events.push("SOURCE_STATUS_CHANGED");
    }

    return {
      next: {
        state: "ACTIVE",
        sourceStatus,
        missingHealthyRunCount: 0,
        missingSince: null,
        removedAt: null,
      },
      events,
      absenceEvaluated: false,
    };
  }

  if (!canEvaluateAbsence(input.healthState, input.inventoryComplete)) {
    return { next: { ...input.current }, events: [], absenceEvaluated: false };
  }

  if (input.current.state === "REMOVED" || input.current.state === "SOLD_MARKED") {
    return { next: { ...input.current }, events: [], absenceEvaluated: true };
  }

  const nextMissingCount = input.current.missingHealthyRunCount + 1;
  const missingSince = input.current.missingSince ?? input.observedAt;

  if (nextMissingCount >= threshold) {
    return {
      next: {
        state: "REMOVED",
        sourceStatus: input.current.sourceStatus,
        missingHealthyRunCount: nextMissingCount,
        missingSince,
        removedAt: input.observedAt,
      },
      events: ["PUBLICATION_REMOVED"],
      absenceEvaluated: true,
    };
  }

  return {
    next: {
      state: "MISSING_PENDING",
      sourceStatus: input.current.sourceStatus,
      missingHealthyRunCount: nextMissingCount,
      missingSince,
      removedAt: null,
    },
    events: input.current.state === "MISSING_PENDING" ? [] : ["PUBLICATION_MISSING_PENDING"],
    absenceEvaluated: true,
  };
}

export type AgencyListingState =
  | "ACTIVE"
  | "EXIT_PENDING"
  | "CLOSED_SOLD"
  | "CLOSED_SWITCHED"
  | "CLOSED_TO_PRIVATE"
  | "CLOSED_WITHDRAWN"
  | "OFF_MARKET_NO_SALE_EVIDENCE";

export function agencyStateForPublication(
  publicationState: PublicationState,
  current: AgencyListingState,
  context: { hasOtherActivePublication?: boolean } = {},
): AgencyListingState {
  if (publicationState === "SOLD_MARKED") {
    return context.hasOtherActivePublication ? "ACTIVE" : "CLOSED_SOLD";
  }
  if (
    publicationState === "REMOVED" &&
    current === "ACTIVE" &&
    !context.hasOtherActivePublication
  ) {
    return "EXIT_PENDING";
  }
  if (publicationState === "ACTIVE" && current === "EXIT_PENDING") {
    return "ACTIVE";
  }
  return current;
}

export type PostExitCheckOutcome =
  | "REAPPEARED"
  | "CLOSED_SOLD"
  | "CLOSED_SWITCHED"
  | "CLOSED_TO_PRIVATE"
  | "CLOSED_WITHDRAWN"
  | "OFF_MARKET_NO_SALE_EVIDENCE"
  | "NEEDS_VERIFICATION";

export function classifyPostExit(input: {
  publicationState: PublicationState;
  sourceStatus: SourceStatus;
  switchedAgencyEvidence: boolean;
  privateRelistEvidence: boolean;
  manualOutcome?: AgencyListingState | null;
}): {
  agencyListingState: AgencyListingState;
  checkOutcome: PostExitCheckOutcome;
  confidence: number;
} {
  const reappeared = input.publicationState === "ACTIVE";
  const explicitSold =
    input.publicationState === "SOLD_MARKED" || input.sourceStatus === "SOLD";
  const agencyListingState =
    input.manualOutcome ??
    (reappeared
      ? "ACTIVE"
      : explicitSold
        ? "CLOSED_SOLD"
        : input.switchedAgencyEvidence
          ? "CLOSED_SWITCHED"
          : input.privateRelistEvidence
            ? "CLOSED_TO_PRIVATE"
            : "OFF_MARKET_NO_SALE_EVIDENCE");
  const checkOutcome =
    agencyListingState === "ACTIVE"
      ? "REAPPEARED"
      : agencyListingState === "EXIT_PENDING"
        ? "NEEDS_VERIFICATION"
        : agencyListingState;
  const confidence = input.manualOutcome
    ? 1
    : explicitSold || input.switchedAgencyEvidence || input.privateRelistEvidence
      ? 0.95
      : reappeared
        ? 1
        : 0.85;

  return { agencyListingState, checkOutcome, confidence };
}
