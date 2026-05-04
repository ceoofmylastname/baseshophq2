/**
 * Helper: chunked bootstrap. Splits the rates array into batches so each
 * execute_sql call stays under ~25KB. The bootstrap RPC is idempotent on
 * (tenant_id, position_code/carrier_name+type/product fields/effective_date)
 * so multiple calls with overlapping payloads (e.g. positions repeated in
 * each chunk) are safe — the second-and-later inserts are skipped.
 *
 * Usage:
 *   bun run scripts/print-bootstrap-payload-chunked.ts <tenant_uuid> <chunk_index> <chunk_size>
 *
 * Chunk 0 includes the full positions, carriers, products arrays and the
 * first chunk_size rates.
 * Chunks 1..N include positions/carriers/products (re-sent for the RPC's
 * payload validator, but idempotent inserts) plus their slice of rates.
 *
 * Total chunks: ceil(rates.length / chunk_size).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAgoraCsv } from "../src/lib/comp-grid-csv-parser.ts";
import { mergeBootstrapPayload } from "../src/lib/comp-grid-bootstrap.ts";

const tenantId = process.argv[2];
const chunkIndex = Number(process.argv[3] ?? "0");
const chunkSize = Number(process.argv[4] ?? "100");

if (!tenantId || Number.isNaN(chunkIndex) || Number.isNaN(chunkSize)) {
  console.error(
    "usage: bun run scripts/print-bootstrap-payload-chunked.ts <tenant_uuid> <chunk_index> <chunk_size>",
  );
  process.exit(2);
}

const root = process.cwd();
const lifeCsv = readFileSync(join(root, "public/seed/agora-life.csv"), "utf-8");
const annuityCsv = readFileSync(join(root, "public/seed/agora-annuity.csv"), "utf-8");

const life = parseAgoraCsv(lifeCsv, "life");
const annuity = parseAgoraCsv(annuityCsv, "annuity");
const full = mergeBootstrapPayload(life, annuity);

const totalChunks = Math.ceil(full.rates.length / chunkSize);
const start = chunkIndex * chunkSize;
const end = Math.min(start + chunkSize, full.rates.length);
const ratesSlice = full.rates.slice(start, end);

const chunkPayload = {
  positions: full.positions,
  carriers: full.carriers,
  products: full.products,
  rates: ratesSlice,
};

const json = JSON.stringify(chunkPayload);

process.stderr.write(
  `[chunk ${chunkIndex + 1}/${totalChunks}] rates ${start}..${end - 1} ` +
    `(${ratesSlice.length} of ${full.rates.length})  size=${json.length} bytes\n`,
);

process.stdout.write(
  `SELECT public.bootstrap_agora_grid_for_tenant(\n` +
    `  '${tenantId}'::uuid,\n` +
    `  $payload$${json}$payload$::jsonb\n` +
    `) AS bootstrap_result;\n`,
);
