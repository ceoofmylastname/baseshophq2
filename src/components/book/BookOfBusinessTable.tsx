import { useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { PolicyRow, SortKey } from "@/hooks/useBookOfBusiness";
import { ALL_COLUMNS, COLUMN_LABELS, type ColumnKey } from "./ColumnChooserDropdown";
import { StatusPillEdit } from "./StatusPillEdit";
import { useAuth } from "@/contexts/AuthContext";

const fmtMoney = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = {
  rows: PolicyRow[];
  visibleColumns: ColumnKey[];
  sortKey: SortKey;
  sortAsc: boolean;
  onSortChange: (key: SortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  loading: boolean;
};

export function BookOfBusinessTable({
  rows, visibleColumns, sortKey, sortAsc, onSortChange,
  selectedIds, onToggleSelect, onToggleSelectAll, loading,
}: Props) {
  const navigate = useNavigate();
  const { isOwner } = useAuth();

  const visible = ALL_COLUMNS.filter((c) => visibleColumns.includes(c));
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {isOwner && (
              <th className="sticky left-0 z-20 w-10 bg-card px-2 py-2">
                <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
              </th>
            )}
            {visible.map((c, idx) => {
              const isFirstNonCheckbox = idx === 0;
              return (
                <th
                  key={c}
                  className={
                    isFirstNonCheckbox
                      ? `sticky ${isOwner ? "left-10" : "left-0"} z-20 min-w-[160px] bg-card px-3 py-2`
                      : "min-w-[110px] px-3 py-2 whitespace-nowrap"
                  }
                >
                  <button
                    onClick={() => onSortChange(c as SortKey)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {COLUMN_LABELS[c]}
                    {sortKey === c && (sortAsc
                      ? <ChevronUp className="h-3 w-3" />
                      : <ChevronDown className="h-3 w-3" />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr><td colSpan={visible.length + (isOwner ? 1 : 0)} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={visible.length + (isOwner ? 1 : 0)} className="px-3 py-6 text-center text-muted-foreground">No policies match the current filters.</td></tr>
          ) : rows.map((r) => {
            const checked = selectedIds.has(r.id);
            return (
              <tr
                key={r.id}
                className={`cursor-pointer border-t hover:bg-muted/40 ${checked ? "bg-primary/5" : ""}`}
                onClick={() => navigate(`/policy/${r.id}`)}
              >
                {isOwner && (
                  <td
                    className="sticky left-0 z-10 w-10 bg-card px-2 py-2"
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(r.id); }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => onToggleSelect(r.id)} />
                  </td>
                )}
                {visible.map((c, idx) => {
                  const stickyClass = idx === 0
                    ? `sticky ${isOwner ? "left-10" : "left-0"} z-10 min-w-[160px] bg-card`
                    : "";
                  return (
                    <td key={c} className={`px-3 py-2 ${stickyClass}`} onClick={(e) => c === "status" && e.stopPropagation()}>
                      {renderCell(c, r)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(c: ColumnKey, r: PolicyRow): React.ReactNode {
  switch (c) {
    case "client_name": {
      const name = [r.client_first_name, r.client_last_name].filter(Boolean).join(" ");
      return <span className="font-medium">{name || "—"}</span>;
    }
    case "carrier": return r.carrier ?? <span className="text-muted-foreground">—</span>;
    case "product": return r.product ?? <span className="text-muted-foreground">—</span>;
    case "policy_number": return <span className="font-mono text-xs">{r.policy_number}</span>;
    case "status": return <StatusPillEdit policyId={r.id} status={r.status} />;
    case "annual_premium": return <span className="tabular-nums">{fmtMoney(r.annual_premium)}</span>;
    case "agent_name": {
      const name = [r.agent_first_name, r.agent_last_name].filter(Boolean).join(" ") || r.agent_email;
      return name ? <span>{name}</span> : <span className="text-amber-700">orphan</span>;
    }
    case "application_date": return r.application_date ?? <span className="text-muted-foreground">—</span>;
    case "effective_date": return r.effective_date ?? <span className="text-muted-foreground">—</span>;
  }
}
