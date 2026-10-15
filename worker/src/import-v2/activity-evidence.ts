type JsonRecord = Record<string, unknown>;
const object = (value: unknown): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value));
const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleUpperCase("it-IT");

function field(record: JsonRecord, name: string): unknown {
  for (const source of [record, record.fields]) if (object(source)) {
    const key = Object.keys(source).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) return source[key];
  }
  return undefined;
}
function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return object(value) ? [value.value, value.displayValue].filter((v): v is string => typeof v === "string") : [];
}
function parse(value: string): unknown {
  try { return JSON.parse(value.replace(/^\s*(?:while\s*\(\s*1\s*\)\s*;|for\s*\(\s*;;\s*\)\s*;|\)\]\}',?\s*)/, "")); }
  catch { return null; }
}

/** Menus and unrelated responses never prove an existing activity. All the
 * evidence must belong to the same persisted Task and its property relation.
 * UI API fields and serialized Aura return values are supported.
 */
export function cloudActivityEvidence(body: string, propertyId: string, description: string, status: string): { found: boolean; unresolved: boolean; activityId: string | null } {
  const nodes: unknown[] = [parse(body)];
  let unresolved = false;
  const expected = normalize(description), expectedStatus = normalize(status);
  for (let visited = 0; nodes.length && visited < 100_000; visited++) {
    const node = nodes.pop();
    if (typeof node === "string") {
      if (/^\s*[\[{]/.test(node)) nodes.push(parse(node));
      continue;
    }
    if (Array.isArray(node)) {
      if (node.length + nodes.length > 100_000) return { found: false, unresolved: true, activityId: null };
      for (const child of node) nodes.push(child);
      continue;
    }
    if (!object(node)) continue;
    const id = values(field(node, "Id"))[0];
    if (id && /^00T[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id)) {
      if (values(field(node, "Description")).some(value => normalize(value) === expected)) {
        const relatedField = field(node, "WhatId");
        const related = values(relatedField)[0];
        const statuses = values(field(node, "Status"));
        // An explicit null means this Task is not related to a property.
        // An omitted field provides no correlation evidence either way.
        const noProperty = relatedField === null || object(relatedField) && relatedField.value === null;
        if (!noProperty) {
          if (!related || related.slice(0, 15) === propertyId.slice(0, 15) && !statuses.length) unresolved = true;
          else if (related.slice(0, 15) === propertyId.slice(0, 15)
            && statuses.some(value => normalize(value) === expectedStatus || expectedStatus === "ESEGUITO" && normalize(value) === "COMPLETED" || expectedStatus === "DA ESEGUIRE" && normalize(value) === "NOT STARTED")) return { found: true, unresolved: false, activityId: id };
        }
      }
    }
    const children = Object.values(node);
    if (children.length + nodes.length > 100_000) return { found: false, unresolved: true, activityId: null };
    for (const child of children) nodes.push(child);
  }
  return { found: false, unresolved: unresolved || nodes.length > 0, activityId: null };
}
