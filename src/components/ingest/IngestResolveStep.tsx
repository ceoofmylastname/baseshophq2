import { useEffect, useMemo, useState } from "react";
import type { PreviewResult, PreviewRow } from "@/hooks/useIngestPreview";
import { useAgentsForResolve } from "@/hooks/useAgentsForResolve";
import { POLICY_STATUS_VALUES } from "@/lib/policy-bucket";
import { Button } from "@/components/ui/button";
import type { DupAction } from "@/pages/Ingest";
import { isFlaggedRowResolved, type Override } from "./ingest-resolve-predicate";

type Props = {
  rows: PreviewRow[];
  results: PreviewResult[];
  dupAction: DupAction;
  onResolved: (rows: PreviewRow[]) => void;
  onBack: () => void;
};

export function IngestResolveStep({ rows, results, dupAction, onResolved, onBack }: Props) {
  const { agents, loading } = useAgentsForResolve();
  const [overrides, setOverrides] = useState<Record<number, Override>>({});

  // Pre-skip duplicates if owner chose skip_duplicates
  useEffect(() => {
    if (dupAction !== "skip_duplicates") return;
    const init: Record<number, Override> = {};
    for (const r of results) {
      if (r.existing_policy_number) init[r.row_index] = { skip: true };
    }
    setOverrides((prev) => ({ ...init, ...prev }));
  }, [dupAction, results]);

  const flaggedRows = useMemo(
    () =>
      results.filter(
        (r) => r.flags.length > 0 || (dupAction === "skip_duplicates" && r.existing_policy_number),
      ),
    [results, dupAction],
  );

  const validAgentEmails = useMemo(
    () => new Set(agents.map((a) => a.email).filter((e): e is string => !!e)),
    [agents],
  );

  const validStatusSet = useMemo<Set<string>>(
    () => new Set(POLICY_STATUS_VALUES),
    [],
  );

  const resolvedFlaggedCount = useMemo(() => {
    return flaggedRows.reduce((acc, r) => {
      const ov = overrides[r.row_index] ?? {};
      return acc + (isFlaggedRowResolved(r.flags, ov, validAgentEmails, validStatusSet) ? 1 : 0);
    }, 0);
  }, [flaggedRows, overrides, validAgentEmails, validStatusSet]);

  const totalRows = rows.length;
  const readyRows = (totalRows - flaggedRows.length) + resolvedFlaggedCount;
  const allReady = readyRows === totalRows;
  const remaining = totalRows - readyRows;

  function setOverride(idx: number, patch: Override) {
    setOverrides((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  }

  function skipAllUnresolved() {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of flaggedRows) {
        const ov = next[r.row_index] ?? {};
        if (!isFlaggedRowResolved(r.flags, ov, validAgentEmails, validStatusSet)) {
          next[r.row_index] = { ...ov, skip: true };
        }
      }
      return next;
    });
  }

  function handleApply() {
    if (!allReady) return; // belt-and-suspenders
    const out: PreviewRow[] = [];
    for (const row of rows) {
      const ov = overrides[row.row_index] ?? {};
      if (ov.skip) continue;
      const payload = { ...row.payload };
      if (ov.agent_email) {
        payload.agent_email = ov.agent_email;
        // clear writing_number per Phase 7 design decision (b): email-match branch takes over
        payload.writing_number = undefined;
      }
      if (ov.product) payload.product = ov.product;
      if (ov.status) payload.status = ov.status;
      out.push({ row_index: row.row_index, payload });
    }
    onResolved(out);
  }

  if (loading) {
    return <div className="rounded-md border p-6 text-sm text-muted-foreground">Loading agents…</div>;
  }

  if (flaggedRows.length === 0) {
    return (
      <div className="space-y-3 rounded-md border p-6">
        <p className="text-sm">No rows need resolution. Ready to commit.</p>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={handleApply}>Next: apply ({rows.length} rows)</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border p-6">
      <p className="text-sm text-muted-foreground">
        Resolve flagged rows. Pick an agent for orphan/unmatched, a canonical product for ambiguous,
        a valid status for unknown — or skip the row.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Policy / carrier / product</th>
            <th className="px-2 py-2">Flags</th>
            <th className="px-2 py-2">Override</th>
          </tr>
        </thead>
        <tbody>
          {flaggedRows.map((r) => {
            const row = rows.find((x) => x.row_index === r.row_index);
            const ov = overrides[r.row_index] ?? {};
            const needAgent = r.flags.includes("orphan") || r.flags.includes("unmatched");
            const needProduct = r.flags.includes("product_ambiguous");
            const needStatus = r.flags.includes("status_unknown");
            return (
              <tr key={r.row_index} className="border-t align-top">
                <td className="px-2 py-2 text-muted-foreground">{r.row_index + 1}</td>
                <td className="px-2 py-2">
                  <div className="font-mono">{row?.payload.policy_number}</div>
                  <div className="text-muted-foreground">
                    {row?.payload.carrier ?? "—"} / {row?.payload.product ?? "—"}
                  </div>
                </td>
                <td className="px-2 py-2 space-x-1">
                  {r.flags.map((f) => (
                    <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">{f}</span>
                  ))}
                  {r.existing_policy_number && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">existing</span>
                  )}
                </td>
                <td className="px-2 py-2 space-y-2">
                  {needAgent && (
                    <select
                      value={ov.agent_email ?? ""}
                      onChange={(e) => setOverride(r.row_index, { agent_email: e.target.value || undefined })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      disabled={ov.skip}
                    >
                      <option value="">— pick agent —</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.email}>
                          {[a.first_name, a.last_name].filter(Boolean).join(" ") || a.email} ({a.email})
                        </option>
                      ))}
                    </select>
                  )}
                  {needProduct && (
                    <input
                      type="text"
                      value={ov.product ?? ""}
                      placeholder="canonical product name"
                      onChange={(e) => setOverride(r.row_index, { product: e.target.value || undefined })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      disabled={ov.skip}
                    />
                  )}
                  {needStatus && (
                    <select
                      value={ov.status ?? ""}
                      onChange={(e) => setOverride(r.row_index, { status: e.target.value || undefined })}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      disabled={ov.skip}
                    >
                      <option value="">— pick status —</option>
                      {POLICY_STATUS_VALUES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={!!ov.skip}
                      onChange={(e) => setOverride(r.row_index, { skip: e.target.checked })}
                    />
                    skip this row
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>Back</Button>
            <Button variant="outline" onClick={skipAllUnresolved}>Skip all unresolved</Button>
          </div>
          <Button onClick={handleApply} disabled={!allReady}>
            Next: apply ({readyRows} of {totalRows} rows ready)
          </Button>
        </div>
        {!allReady && (
          <p className="text-right text-xs text-muted-foreground">
            Resolve or skip the remaining {remaining} row{remaining === 1 ? "" : "s"} to continue
          </p>
        )}
      </div>
    </div>
  );
}
