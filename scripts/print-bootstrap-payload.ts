/**
 * Helper: parses both bundled Agora CSVs and prints the merged bootstrap
 * payload as a SQL statement that invokes bootstrap_agora_grid_for_tenant.
 *
 * Run:
 *   bun run scripts/print-bootstrap-payload.ts <tenant_uuid> > /tmp/bootstrap.sql
 *
 * The output is a single SELECT statement using $payload$ dollar-quoting so
 * the embedded JSON (which contains single quotes in product names like
 * "Term/ Builder +3 IUL(A)") doesn't need escaping.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgoraCsv } from "../src/lib/comp-grid-csv-parser.ts";
import { mergeBootstrapPayload } from "../src/lib/comp-grid-bootstrap.ts";

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("usage: bun run scripts/print-bootstrap-payload.ts <tenant_uuid>");
  process.exit(2);
}

const root = process.cwd();
const lifeCsv = readFileSync(join(root, "public/seed/agora-life.csv"), "utf-8");
const annuityCsv = readFileSync(join(root, "public/seed/agora-annuity.csv"), "utf-8");

const life = parseAgoraCsv(lifeCsv, "life");
const annuity = parseAgoraCsv(annuityCsv, "annuity");
const payload = mergeBootstrapPayload(life, annuity);

const json = JSON.stringify(payload);

process.stdout.write(
  `SELECT public.bootstrap_agora_grid_for_tenant(\n` +
    `  '${tenantId}'::uuid,\n` +
    `  $payload$${json}$payload$::jsonb\n` +
    `) AS bootstrap_result;\n`,
);
