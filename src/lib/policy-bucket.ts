/**
 * Maps the seven canonical policy_status enum values to the operator
 * buckets used by the dashboard + Book of Business filters.
 *
 * Five buckets are exposed in the UI dropdown. Four of them have a 1:1
 * status->bucket relationship via BUCKET_MAP (Pipeline / Booked / Realized /
 * At-Risk / Other). The fifth — "Active" — is a UNION bucket covering both
 * Issued and Issue Paid; it lets owners answer "show me everything currently
 * in force" without mentally summing two statuses. Because Active overlaps
 * with Booked and Realized, statusToBucket continues to return the 1:1
 * mapping. Only statusesInBucket knows about Active.
 */

export type PolicyStatus =
  | "Draft" | "Submitted" | "Pending" | "Issued" | "Issue Paid"
  | "Terminated" | "Potential Lapse";

export type PolicyBucket = "Pipeline" | "Booked" | "Realized" | "At-Risk" | "Active" | "Other";

const BUCKET_MAP: Record<PolicyStatus, PolicyBucket> = {
  Draft: "Other",
  Submitted: "Pipeline",
  Pending: "Pipeline",
  Issued: "Booked",
  "Issue Paid": "Realized",
  Terminated: "Other",
  "Potential Lapse": "At-Risk",
};

export function statusToBucket(status: PolicyStatus): PolicyBucket {
  return BUCKET_MAP[status] ?? "Other";
}

export const POLICY_STATUS_VALUES: PolicyStatus[] = [
  "Draft", "Submitted", "Pending", "Issued", "Issue Paid",
  "Terminated", "Potential Lapse",
];

export const POLICY_BUCKETS: PolicyBucket[] = [
  "Pipeline", "Booked", "Realized", "At-Risk", "Active", "Other",
];

/** Returns the set of statuses that map to the given bucket. */
export function statusesInBucket(bucket: PolicyBucket): PolicyStatus[] {
  if (bucket === "Active") return ["Issued", "Issue Paid"];
  return POLICY_STATUS_VALUES.filter((s) => statusToBucket(s) === bucket);
}

/**
 * Parse a lowercase URL-param bucket key (e.g. `pipeline`, `at_risk`,
 * `active`, `other`) into the TitleCase PolicyBucket enum. Returns null
 * for unrecognised values so callers can treat parsing as best-effort.
 */
const URL_BUCKET_MAP: Record<string, PolicyBucket> = {
  pipeline: "Pipeline",
  booked:   "Booked",
  realized: "Realized",
  at_risk:  "At-Risk",
  active:   "Active",
  other:    "Other",
};

export function parseBucketParam(s: string | null): PolicyBucket | null {
  if (!s) return null;
  return URL_BUCKET_MAP[s.toLowerCase()] ?? null;
}
