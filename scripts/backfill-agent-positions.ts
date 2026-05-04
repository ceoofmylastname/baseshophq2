/**
 * scripts/backfill-agent-positions.ts
 *
 * Interactive CLI to assign existing agents to positions and template their
 * per-agent rates from the master grid. Used during migrations from another
 * platform OR for backfilling position assignments after the carrier ingest
 * pipeline (Phase 4) has imported the first agents.
 *
 * SCAFFOLD STATUS — INTENTIONALLY IDLE THROUGH PHASE 3a
 *
 *   Right now the build has no agents in the agents table (Phase 1 schema
 *   exists but no signup/onboarding flow has been wired). This script will
 *   detect zero agents and exit cleanly with a message rather than running.
 *   The interactive prompt structure below is the contract Phase 4 will
 *   exercise once the first agents have been created (either via the eventual
 *   signup edge function or the bulk-CSV import flow per the wiki).
 *
 * Behavior contract (when Phase 4 enables it):
 *
 *   1. Read all agents in the target tenant where no open agent_positions row
 *      exists (i.e. agents with no current position assignment).
 *   2. Read all available comp_grid_positions in the tenant, sorted by
 *      sort_order DESC so the most senior positions appear first.
 *   3. For each agent, prompt the operator to pick a position from the list
 *      (or skip the agent).
 *   4. Call assign_agent_to_position with the chosen position, start_date =
 *      tenants.created_at (so historical policies are covered), and
 *      p_overrides_action = 'keep' (no prior overrides should exist on a
 *      true backfill — defensive default).
 *   5. Print the per-agent template result (rates_inserted, schedule_code
 *      coverage, etc.) and continue to the next agent.
 *
 * Usage (once enabled):
 *
 *   bun run scripts/backfill-agent-positions.ts \
 *     --tenant-id <uuid> \
 *     [--dry-run]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 */

// NOTE: This file is a scaffold. The implementation is deliberately gated by
// the agent-count check and exits idle if zero agents exist. Once Phase 4
// imports policies and creates agents (via the carrier ingest pipeline or the
// bulk import surface), the gate will pass and the prompt loop will run.
// Until then, running this script is a no-op with an informative message.

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.tenantId) {
    console.error("missing --tenant-id <uuid>");
    process.exit(2);
  }

  console.log(`[backfill-agent-positions] tenant=${args.tenantId} dry-run=${args.dryRun}`);

  // Phase 3a no-op gate. Replace with a real Supabase client + RPC calls once
  // Phase 4 has agents to backfill.
  const agentCount = await countAgentsWithoutPosition(args.tenantId);
  if (agentCount === 0) {
    console.log(
      "[backfill-agent-positions] no agents pending position assignment — exiting clean.",
    );
    console.log(
      "  The interactive prompt loop is gated on agent count and will activate",
    );
    console.log(
      "  once Phase 4 (carrier ingest + agent provisioning) creates the first",
    );
    console.log(
      "  agents in this tenant. See script header for the full behavior contract.",
    );
    process.exit(0);
  }

  // Phase 4 will wire the prompt loop here:
  //
  // const positions = await readPositions(args.tenantId);
  // for (const agent of await readAgentsWithoutPosition(args.tenantId)) {
  //   const choice = await promptForPosition(agent, positions);
  //   if (choice === SKIP) continue;
  //   const result = await assignAgentToPosition({
  //     agentId: agent.id,
  //     positionId: choice.id,
  //     startDate: tenant.created_at_date,
  //     assignedBy: null,           // backfill, no UI actor
  //     overridesAction: "keep",
  //     supabaseAdminClient: client,
  //   });
  //   console.log(`  ${agent.email}: ${result.template_result.rates_inserted} rates inserted`);
  // }
  console.log(
    "[backfill-agent-positions] reached the gated section — Phase 4 wiring needed.",
  );
}

type Args = {
  tenantId: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { tenantId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant-id" && i + 1 < argv.length) {
      out.tenantId = argv[i + 1] ?? null;
      i++;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
}

/**
 * STUB: returns 0 in Phase 3a. Phase 4 replaces with a real Supabase query.
 * Keeping the function shape now means Phase 4 only swaps the body, not the
 * call site in main().
 */
async function countAgentsWithoutPosition(_tenantId: string): Promise<number> {
  return 0;
}

main().catch((err) => {
  console.error("[backfill-agent-positions] fatal:", err);
  process.exit(1);
});
