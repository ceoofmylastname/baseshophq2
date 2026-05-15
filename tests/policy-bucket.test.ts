/**
 * Pure tests for the policy-bucket helpers.
 *
 * Covers:
 *   - parseBucketParam round-trips all canonical lowercase keys
 *   - parseBucketParam returns null for junk + null + empty string
 *   - parseBucketParam is case-insensitive
 *   - statusesInBucket("Active") returns both Issued and Issue Paid (the
 *     bonus union bucket we just added)
 *   - statusesInBucket continues to return clean 1:1 sets for the other
 *     buckets — Active should NOT contaminate them
 *   - bucketDestinationUrl produces the right query for each BucketKey
 *     (pipeline/active stay as ?bucket=, the rest map to ?status=…),
 *     and carrierId / agentId propagate correctly.
 */

import { describe, expect, test } from "bun:test";
import {
  parseBucketParam,
  statusesInBucket,
  POLICY_BUCKETS,
} from "../src/lib/policy-bucket.ts";
import { bucketDestinationUrl } from "../src/lib/bucket-destination.ts";

describe("parseBucketParam", () => {
  test.each([
    ["pipeline", "Pipeline"],
    ["booked",   "Booked"],
    ["realized", "Realized"],
    ["at_risk",  "At-Risk"],
    ["active",   "Active"],
    ["other",    "Other"],
  ])("'%s' -> '%s'", (input, expected) => {
    expect(parseBucketParam(input)).toBe(expected as never);
  });

  test("is case-insensitive", () => {
    expect(parseBucketParam("PIPELINE")).toBe("Pipeline");
    expect(parseBucketParam("At_Risk")).toBe("At-Risk");
  });

  test("returns null for junk / null / empty", () => {
    expect(parseBucketParam(null)).toBeNull();
    expect(parseBucketParam("")).toBeNull();
    expect(parseBucketParam("garbage")).toBeNull();
    expect(parseBucketParam("at-risk")).toBeNull(); // underscore is canonical, not hyphen
  });
});

describe("statusesInBucket", () => {
  test("Active is the union of Issued + Issue Paid", () => {
    expect(statusesInBucket("Active").sort()).toEqual(["Issue Paid", "Issued"]);
  });

  test("Booked stays 1:1 with Issued (Active does not leak in)", () => {
    expect(statusesInBucket("Booked")).toEqual(["Issued"]);
  });

  test("Realized stays 1:1 with Issue Paid", () => {
    expect(statusesInBucket("Realized")).toEqual(["Issue Paid"]);
  });

  test("Pipeline is Submitted + Pending", () => {
    expect(statusesInBucket("Pipeline").sort()).toEqual(["Pending", "Submitted"]);
  });

  test("At-Risk is Potential Lapse only", () => {
    expect(statusesInBucket("At-Risk")).toEqual(["Potential Lapse"]);
  });

  test("Other contains Draft + Terminated", () => {
    expect(statusesInBucket("Other").sort()).toEqual(["Draft", "Terminated"]);
  });

  test("POLICY_BUCKETS contains all five exposed buckets plus Other", () => {
    expect(POLICY_BUCKETS).toEqual(["Pipeline", "Booked", "Realized", "At-Risk", "Active", "Other"]);
  });
});

describe("bucketDestinationUrl", () => {
  test("pipeline uses ?bucket=pipeline", () => {
    const url = bucketDestinationUrl({ bucket: "pipeline", carrierId: null });
    expect(url).toBe("/book-of-business?bucket=pipeline");
  });

  test("active uses ?bucket=active", () => {
    const url = bucketDestinationUrl({ bucket: "active", carrierId: null });
    expect(url).toBe("/book-of-business?bucket=active");
  });

  test("booked uses ?status=Issued", () => {
    const url = bucketDestinationUrl({ bucket: "booked", carrierId: null });
    expect(url).toContain("status=Issued");
  });

  test("realized uses ?status=Issue+Paid", () => {
    const url = bucketDestinationUrl({ bucket: "realized", carrierId: null });
    expect(url).toMatch(/status=Issue(\+|%20)Paid/);
  });

  test("at_risk uses ?status=Potential+Lapse", () => {
    const url = bucketDestinationUrl({ bucket: "at_risk", carrierId: null });
    expect(url).toMatch(/status=Potential(\+|%20)Lapse/);
  });

  test("terminated uses ?status=Terminated", () => {
    const url = bucketDestinationUrl({ bucket: "terminated", carrierId: null });
    expect(url).toContain("status=Terminated");
  });

  test("booked_commission uses ?status=Issued", () => {
    const url = bucketDestinationUrl({ bucket: "booked_commission", carrierId: null });
    expect(url).toContain("status=Issued");
  });

  test("realized_commission uses ?status=Issue+Paid", () => {
    const url = bucketDestinationUrl({ bucket: "realized_commission", carrierId: null });
    expect(url).toMatch(/status=Issue(\+|%20)Paid/);
  });

  test("carrierId propagates as &carrier=…", () => {
    const url = bucketDestinationUrl({ bucket: "booked", carrierId: "c-123" });
    expect(url).toContain("carrier=c-123");
  });

  test("agentId propagates as &agent=…", () => {
    const url = bucketDestinationUrl({ bucket: "active", carrierId: null, agentId: "a-456" });
    expect(url).toContain("agent=a-456");
  });

  test("both carrier and agent propagate together", () => {
    const url = bucketDestinationUrl({ bucket: "active", carrierId: "c-1", agentId: "a-1" });
    expect(url).toContain("carrier=c-1");
    expect(url).toContain("agent=a-1");
  });

  test("no agentId given → no agent param", () => {
    const url = bucketDestinationUrl({ bucket: "booked", carrierId: null });
    expect(url).not.toContain("agent=");
  });
});
