import type { StreetRegistryOutcome } from "./street-registry.js";

/** The next claim is allowed only after acquisition AND CRM import settle. */
export async function runStreetRegistrySequence<T>(options: {
  isCancelled: () => boolean;
  next: () => Promise<T | null>;
  onClaim: (claim: T) => Promise<void>;
  waitForStreet: () => Promise<void>;
  outcome: () => StreetRegistryOutcome | null;
  onFinished: (claim: T, outcome: StreetRegistryOutcome) => Promise<void>;
}): Promise<"exhausted" | "cancelled" | "attention"> {
  while (!options.isCancelled()) {
    const claim = await options.next();
    if (!claim) return "exhausted";
    await options.onClaim(claim);
    await options.waitForStreet();
    const outcome = options.outcome() ?? "to_recheck";
    await options.onFinished(claim, outcome);
    if (outcome !== "completed") return "attention";
  }
  return "cancelled";
}
