export interface ManualOverride<T> {
  id: string;
  overrideKey: string;
  overrideValue: T;
  effectiveAt: string;
  createdAt: string;
  supersedesId: string | null;
  reason: string;
}

export interface AuthoritativeValue<T> {
  value: T;
  source: "DERIVED" | "MANUAL_OVERRIDE";
  overrideId: string | null;
  reason: string | null;
}

export function resolveAuthoritativeValue<T>(input: {
  key: string;
  derivedValue: T;
  overrides: ManualOverride<T>[];
  asOf: string;
}): AuthoritativeValue<T> {
  const asOfTime = Date.parse(input.asOf);
  const applicable = input.overrides.filter(
    (override) =>
      override.overrideKey === input.key && Date.parse(override.effectiveAt) <= asOfTime,
  );
  const supersededIds = new Set(
    applicable
      .map((override) => override.supersedesId)
      .filter((id): id is string => Boolean(id)),
  );
  const active = applicable
    .filter((override) => !supersededIds.has(override.id))
    .sort((left, right) => {
      const effectiveDifference = Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt);
      return effectiveDifference || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })[0];

  if (!active) {
    return {
      value: input.derivedValue,
      source: "DERIVED",
      overrideId: null,
      reason: null,
    };
  }

  return {
    value: active.overrideValue,
    source: "MANUAL_OVERRIDE",
    overrideId: active.id,
    reason: active.reason,
  };
}
