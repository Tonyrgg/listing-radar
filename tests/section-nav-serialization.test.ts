import { describe, expect, it } from "vitest";

import { LifecycleSectionNav } from "@/components/lifecycle-section-nav";
import { MatchingSectionNav } from "@/components/matching/section-nav";

function assertSerializableNavigation(element: ReturnType<typeof LifecycleSectionNav>) {
  const items = element.props.items as Array<Record<string, unknown>>;
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => typeof item.href === "string"
    && typeof item.label === "string"
    && typeof item.icon === "string")).toBe(true);
  expect(() => JSON.stringify(items)).not.toThrow();
}

describe("confine server/client delle navigazioni di sezione", () => {
  it("passa al client soltanto dati serializzabili per Segnali", () => {
    assertSerializableNavigation(LifecycleSectionNav());
  });

  it("passa al client soltanto dati serializzabili per Commerciale", () => {
    assertSerializableNavigation(MatchingSectionNav());
  });
});
