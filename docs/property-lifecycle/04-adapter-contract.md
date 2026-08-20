# Adapter and Normalized Contract

## Common interface

Every source adapter implements the conceptual operations below:

```ts
healthCheck(): Promise<AdapterHealthResult>
fetchInventory(): Promise<InventoryResult>
fetchDetail(item): Promise<SourceDocument>
normalize(document): Promise<NormalizedListingV2>
```

Media, floorplan, date, location, and status extraction are explicit adapter responsibilities, whether exposed as separate methods or composed by `normalize`.

## Contract sections

`NormalizedListingV2` contains:

- contract version and adapter key;
- source agency identity, external ID, canonical URL, and agency reference;
- transaction and property type;
- title, description, price, surface, room, bedroom, bathroom, floor, and feature values;
- structured location with raw text, locality, municipality, postal code, street hints, and scope decision;
- normalized source status plus dedicated status evidence;
- media/floorplan assets with canonical URL and optional date/fingerprint hints;
- market-start estimate as a bounded interval, method, confidence, and supporting evidence;
- observed time, source response metadata, content hash, extraction warnings, and raw provenance.

The runtime schema rejects malformed output before persistence. Unknown or absent values remain `null`; adapters must not fabricate zeros or false booleans.

## Inventory result

An inventory fetch returns items plus completeness diagnostics: expected/observed count, pagination visited, duplicate source keys, parse errors, and a structure fingerprint. A successful HTTP response alone is not a healthy inventory.

## Health classification

- `HEALTHY`: key selectors/markers present, counts plausible, parsing error ratio acceptable, and inventory complete.
- `DEGRADED`: content is usable for positive observations but incomplete or suspicious; no absence decisions.
- `STRUCTURE_CHANGED`: required structure fingerprint or selectors no longer match; no absence decisions and review created.
- `FAILED`: transport/auth/server failure or no usable document; no commercial state mutation.

## Evidence rules

Each extracted claim carries a source URL, evidence kind, extraction method, raw value where safe, observed timestamp, and confidence. Strong evidence is explicit source data (dedicated status taxonomy, source publication date). Weaker evidence includes upload-path dates and crawler first-seen dates. Generic HTTP `Last-Modified`, page-wide keyword matches, and unrelated media dates cannot independently establish a lifecycle conclusion.
