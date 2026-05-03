/**
 * Agora master grid bootstrap orchestrator.
 *
 * Reads the bundled Life and Annuity CSVs, parses them via
 * `comp-grid-csv-parser`, and writes positions, carriers, products, and rates
 * into the comp_grid_* tables for a given tenant.
 *
 * Idempotent: re-running on a seeded tenant is a no-op. The orchestrator
 * upserts on the unique keys defined in the Phase 1 schema:
 *   - comp_grid_positions  : (tenant_id, position_code)
 *   - comp_grid_carriers   : (tenant_id, carrier_name, product_type)
 *   - comp_grid_products   : (tenant_id, carrier_id, product_name, product_variant)
 *                            with NULLS NOT DISTINCT
 *   - comp_grid_rates      : (tenant_id, position_id, product_id, effective_date)
 *
 * Transactional: all inserts run inside a single Postgres transaction via the
 * Supabase service-role RPC `bootstrap_agora_grid_for_tenant` (defined in the
 * Phase 2 SQL migration). If any insert fails, the entire bootstrap rolls
 * back and the tenant is left in its prior state.
 *
 * Usage:
 *   import { bootstrapAgoraGridForTenant } from "@/lib/comp-grid-bootstrap";
 *   await bootstrapAgoraGridForTenant({ tenantId, supabaseAdminClient });
 *
 * Auto-fires from the eventual signup edge function (deferred from Phase 1).
 * For now, exposed as a manually-callable function so the first tenant can be
 * seeded by script for Phase 3 testing.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseAgoraCsv,
  type ParsedAgora,
  type ParsedCarrier,
  type ParsedProduct,
  type ParsedRate,
  type ParsedPosition,
} from "./comp-grid-csv-parser.ts";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const DEFAULT_LIFE_CSV_PATH = "public/seed/agora-life.csv";
const DEFAULT_ANNUITY_CSV_PATH = "public/seed/agora-annuity.csv";

export type BootstrapInput = {
  tenantId: string;
  /**
   * The Supabase service-role client. Must bypass RLS to run the
   * `bootstrap_agora_grid_for_tenant` RPC.
   */
  supabaseAdminClient: SupabaseLikeClient;
  /** Override for testing or alternate file locations. */
  lifeCsvPath?: string;
  annuityCsvPath?: string;
  /** Override the project root for resolving relative CSV paths. */
  projectRoot?: string;
};

export type BootstrapResult = {
  positions_inserted: number;
  carriers_inserted: number;
  products_inserted: number;
  rates_inserted: number;
  was_noop: boolean;
};

// Minimal client shape so this file doesn't take a hard dep on @supabase/supabase-js
// during the parser-only test phase. The real call wires through a Supabase client.
export interface SupabaseLikeClient {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Orchestrate the full Agora bootstrap for one tenant.
 *
 * The orchestrator parses both CSVs in the Node process, then ships the
 * normalized payload to the SQL RPC `bootstrap_agora_grid_for_tenant` for
 * transactional insertion under service-role privileges.
 */
export async function bootstrapAgoraGridForTenant(
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const root = input.projectRoot ?? process.cwd();
  const lifeCsv = await readFile(
    join(root, input.lifeCsvPath ?? DEFAULT_LIFE_CSV_PATH),
    "utf-8",
  );
  const annuityCsv = await readFile(
    join(root, input.annuityCsvPath ?? DEFAULT_ANNUITY_CSV_PATH),
    "utf-8",
  );

  const life = parseAgoraCsv(lifeCsv, "life");
  const annuity = parseAgoraCsv(annuityCsv, "annuity");

  const payload = mergeBootstrapPayload(life, annuity);

  const { data, error } = await input.supabaseAdminClient.rpc(
    "bootstrap_agora_grid_for_tenant",
    {
      p_tenant_id: input.tenantId,
      p_payload: payload,
    },
  );

  if (error) {
    throw new Error(`bootstrap_agora_grid_for_tenant RPC failed: ${error.message}`);
  }

  return data as BootstrapResult;
}

/**
 * Merge a Life parse and an Annuity parse into a single payload for the RPC.
 *
 * Positions are deduplicated across the two CSVs (they share the same Agora
 * ladder). Carriers, products, and rates concat (each carries its own
 * product_type discriminator).
 */
export function mergeBootstrapPayload(
  life: ParsedAgora,
  annuity: ParsedAgora,
): {
  positions: ParsedPosition[];
  carriers: ParsedCarrier[];
  products: ParsedProduct[];
  rates: ParsedRate[];
} {
  // Dedupe positions by position_code (life and annuity share the same ladder).
  const positionMap = new Map<string, ParsedPosition>();
  for (const p of [...life.positions, ...annuity.positions]) {
    if (!positionMap.has(p.position_code)) positionMap.set(p.position_code, p);
  }

  return {
    positions: [...positionMap.values()].sort((a, b) => b.sort_order - a.sort_order),
    carriers: [...life.carriers, ...annuity.carriers],
    products: [...life.products, ...annuity.products],
    rates: [...life.rates, ...annuity.rates],
  };
}
