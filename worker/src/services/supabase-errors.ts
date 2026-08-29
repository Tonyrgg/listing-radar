const restrictionPattern = /(?:http\s*)?402|payment required|quota (?:is )?(?:exceeded|superata)|over (?:its |the )?quota|egress|fair use|billing/i;

function errorFacts(error: unknown, seen = new Set<object>()): string[] {
  if (error == null) return [];
  if (typeof error === "string" || typeof error === "number") return [String(error)];
  if (error instanceof Error) {
    if (seen.has(error)) return [];
    seen.add(error);
    const cause = "cause" in error ? error.cause : undefined;
    return [error.name, error.message, ...errorFacts(cause, seen)];
  }
  if (typeof error !== "object") return [String(error)];
  if (seen.has(error)) return [];
  seen.add(error);
  const record = error as Record<string, unknown>;
  return ["status", "statusCode", "code", "message", "details", "hint"]
    .flatMap((key) => errorFacts(record[key], seen));
}

export function isSupabaseProjectRestricted(error: unknown) {
  return errorFacts(error).some((fact) => restrictionPattern.test(fact));
}

export function describeSupabaseOperationalError(error: unknown) {
  if (isSupabaseProjectRestricted(error)) {
    return "Supabase ha limitato temporaneamente il progetto (HTTP 402/quota). "
      + "Le run con persistenza cloud sono sospese prima di modificare il gestionale; gli aggiornamenti software restano disponibili da GitHub.";
  }
  return error instanceof Error ? error.message : String(error);
}
