# Property Identity V1

## Principle

Identity is a scored decision with provenance, not an incidental URL join. The engine compares a normalized observation with plausible existing properties, records every meaningful candidate, and then returns one of three outcomes.

## Candidate retrieval

Candidates are restricted to the monitored geography and narrowed by available locality, street/address tokens, property type, surface band, room count, agency reference history, and media fingerprints. Missing fields broaden retrieval but reduce confidence.

## Feature score

The initial score is a weighted combination of:

- exact source continuity or agency reference continuity;
- exact/near-exact address tokens and locality;
- image or floorplan fingerprint overlap;
- surface similarity;
- room/bed/bath similarity;
- property type compatibility;
- price trajectory plausibility;
- title/description token similarity.

Contradictions—different explicit addresses, incompatible type, large surface mismatch, or simultaneous implausible active records—apply penalties or block auto-match. The stored explanation includes each feature value, weight, contribution, and contradiction.

## Outcomes

- `AUTO_MATCH`: top score meets the high threshold, has no blocking contradiction, and leads the runner-up by the required margin.
- `REVIEW_REQUIRED`: evidence is plausible but ambiguous, contradictory, or the margin is insufficient. A review queue item is created.
- `NEW_PROPERTY`: no candidate reaches the lower plausibility threshold.

Initial policy targets are deliberately conservative: auto-match at 0.86 with at least 0.12 margin; review at 0.58 or above. Exact source continuity may match its already-linked property directly but is still auditable.

## Corrections

A reviewer can confirm, reject, merge, or split through a manual override. Candidate scores and original snapshots are retained. Corrections do not delete the mistaken inference; they add an authoritative decision and can trigger recomputation of derived opportunities and market age.
