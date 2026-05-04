/**
 * Maps the seven canonical policy_status enum values to the four operator
 * buckets used by the dashboard + Book of Business filters.
 */

export type PolicyStatus =
  | "Draft" | "Submitted" | "Pending" | "Issued" | "Issue Paid"
  | "Terminated" | "Potential Lapse";

export type PolicyBucket = "Pipeline" | "Booked" | "Realized" | "At-Risk" | "Other";

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
  "Pipeline", "Booked", "Realized", "At-Risk", "Other",
];

/** Returns the set of statuses that map to the given bucket. */
export function statusesInBucket(bucket: PolicyBucket): PolicyStatus[] {
  return POLICY_STATUS_VALUES.filter((s) => statusToBucket(s) === bucket);
}
