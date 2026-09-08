import { describe, expect, it } from "vitest";

import { stepRequiresSister } from "../src/core/sister-requirement.js";

describe("dipendenza runtime da SISTER", () => {
  it.each([null, "ready", "sister_results_acquired", "properties_extracted", "owners_extracted"])(
    "richiede SISTER durante %s",
    (step) => expect(stepRequiresSister(step)).toBe(true),
  );

  it.each(["data_normalized", "acquisition_reviewed", "properties_processed", "verified", "completed"])(
    "non richiede SISTER durante %s",
    (step) => expect(stepRequiresSister(step)).toBe(false),
  );
});
