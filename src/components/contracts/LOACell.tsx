/**
 * Phase 10E: LOA cell display per wiki/contracts-page.md.
 *
 * Format: "Lastname, Firstname: WRITINGNUMBER" if LOA, "None" if direct pay.
 */

import type { ContractRow } from "@/hooks/useContracts";

export function LOACell({ contract }: { contract: ContractRow }) {
  if (!contract.loa_upline_agent_id) {
    return <span className="text-xs text-muted-foreground">None</span>;
  }
  const writing = contract.loa_upline_writing
    ? `: ${contract.loa_upline_writing}`
    : ` (no contract on this carrier)`;
  return (
    <span className="text-xs">
      {contract.loa_upline_name}
      <span className="text-muted-foreground">{writing}</span>
    </span>
  );
}
