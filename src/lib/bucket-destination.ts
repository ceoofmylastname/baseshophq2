/**
 * Build the Book-of-Business URL for a bucket-key drill-through. Lives
 * in its own module so unit tests can import it without dragging in
 * the React component tree (and through it, supabase-browser, which
 * loads env vars at import time).
 *
 * Status buckets (Submitted/Pending/Issued/Issue Paid/Terminated/
 * Potential Lapse) use `?status=<TitleCase>` so an existing in-page
 * filter dropdown lines up. Pipeline and Active are unions and use
 * `?bucket=<key>`.
 */

export type BucketKey =
  | "pipeline"
  | "submitted"
  | "pending"
  | "booked"
  | "realized"
  | "at_risk"
  | "active"
  | "terminated"
  | "booked_policies"
  | "booked_commission"
  | "realized_commission";

export function bucketDestinationUrl(args: {
  bucket: BucketKey;
  carrierId: string | null;
  agentId?: string | null;
}): string {
  const params = new URLSearchParams();
  switch (args.bucket) {
    case "pipeline":            params.set("bucket", "pipeline"); break;
    case "active":              params.set("bucket", "active");   break;
    case "submitted":           params.set("status", "Submitted"); break;
    case "pending":             params.set("status", "Pending");   break;
    case "booked":              params.set("status", "Issued");    break;
    case "realized":            params.set("status", "Issue Paid");break;
    case "at_risk":             params.set("status", "Potential Lapse"); break;
    case "terminated":          params.set("status", "Terminated"); break;
    case "booked_policies":     params.set("status", "Issued");    break;
    case "booked_commission":   params.set("status", "Issued");    break;
    case "realized_commission": params.set("status", "Issue Paid");break;
  }
  if (args.carrierId) params.set("carrier", args.carrierId);
  if (args.agentId)   params.set("agent", args.agentId);
  return `/book-of-business?${params.toString()}`;
}
