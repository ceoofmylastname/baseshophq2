/**
 * Pure-logic helper for IngestResolveStep — extracted so it can be unit-tested
 * without React. Determines whether a flagged preview row has been fully
 * resolved by the operator's override choices.
 *
 * A flagged row is resolved iff one of:
 *   - `skip === true` (operator dropped it)
 *   - every flag has a valid override:
 *       product_ambiguous → override.product is a non-empty trimmed string
 *       orphan | unmatched → override.agent_email is in the valid-emails set
 *       status_unknown → override.status is in the POLICY_STATUS_VALUES set
 */

import type { IngestFlag } from "@/hooks/useIngestPreview";

export type Override = {
  agent_email?: string;
  product?: string;
  status?: string;
  skip?: boolean;
};

export function isFlaggedRowResolved(
  flags: IngestFlag[],
  override: Override,
  validAgentEmails: Set<string>,
  validStatusSet: Set<string>,
): boolean {
  if (override.skip === true) return true;

  for (const f of flags) {
    switch (f) {
      case "product_ambiguous": {
        if (!override.product || override.product.trim().length === 0) return false;
        break;
      }
      case "orphan":
      case "unmatched": {
        if (!override.agent_email || !validAgentEmails.has(override.agent_email)) return false;
        break;
      }
      case "status_unknown": {
        if (!override.status || !validStatusSet.has(override.status)) return false;
        break;
      }
    }
  }
  return true;
}
