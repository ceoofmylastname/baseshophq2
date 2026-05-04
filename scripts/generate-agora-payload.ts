/**
 * scripts/generate-agora-payload.ts
 *
 * Re-run when public/seed/agora-life.csv or agora-annuity.csv changes.
 * Outputs the merged bootstrap payload as JSON to:
 *   supabase/functions/signup/agora-payload.json
 *
 * The signup edge function imports this JSON statically and passes it as the
 * p_agora_payload argument to provision_tenant_and_owner during signup, so
 * every new tenant lands with the master grid pre-seeded.
 *
 * Usage:
 *   bun run scripts/generate-agora-payload.ts
 *
 * CI integration (deferred):
 *   Add a CI step that regenerates and `git diff --exit-code`s the JSON to
 *   fail the build when a CSV change wasn't accompanied by a payload regen.
 *   Until CI is wired, the developer is responsible for re-running this
 *   script after any CSV edit.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseAgoraCsv } from "../src/lib/comp-grid-csv-parser.ts";
import { mergeBootstrapPayload } from "../src/lib/comp-grid-bootstrap.ts";

const root = process.cwd();
const lifeCsv    = readFileSync(join(root, "public/seed/agora-life.csv"),    "utf-8");
const annuityCsv = readFileSync(join(root, "public/seed/agora-annuity.csv"), "utf-8");

const life    = parseAgoraCsv(lifeCsv,    "life");
const annuity = parseAgoraCsv(annuityCsv, "annuity");
const merged  = mergeBootstrapPayload(life, annuity);

const outputPath = join(root, "supabase/functions/signup/agora-payload.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(merged) + "\n", "utf-8");

console.log(`[generate-agora-payload] wrote ${outputPath}`);
console.log(
  `  positions=${merged.positions.length}` +
  `  carriers=${merged.carriers.length}` +
  `  products=${merged.products.length}` +
  `  rates=${merged.rates.length}`,
);
