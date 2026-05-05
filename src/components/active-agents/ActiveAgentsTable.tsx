import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAgents, type ActiveAgentRow } from "@/hooks/useActiveAgents";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type SortKey = "agent_name" | "position_code" | "last_policy_date" | "policies_count" | "premium_total" | "status";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Props = { days: number };

export function ActiveAgentsTable({ days }: Props) {
  const navigate = useNavigate();
  const { rows, loading } = useActiveAgents({ days });
  const [sortKey, setSortKey] = useState<SortKey>("last_policy_date");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      const as = (av ?? "") as string;
      const bs = (bv ?? "") as string;
      return sortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  function onSort(key: SortKey) {
    if (key === sortKey) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents wrote a policy in the last {days} days.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <Th label="Agent" sortKey="agent_name" current={sortKey} asc={sortAsc} onClick={onSort} />
            <Th label="Position" sortKey="position_code" current={sortKey} asc={sortAsc} onClick={onSort} />
            <Th label="Last policy" sortKey="last_policy_date" current={sortKey} asc={sortAsc} onClick={onSort} />
            <Th label="Policies" sortKey="policies_count" current={sortKey} asc={sortAsc} onClick={onSort} align="right" />
            <Th label="Premium" sortKey="premium_total" current={sortKey} asc={sortAsc} onClick={onSort} align="right" />
            <Th label="Status" sortKey="status" current={sortKey} asc={sortAsc} onClick={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => <Row key={r.agent_id} row={r} onClick={() => navigate(`/agents/${r.agent_id}`)} />)}
        </tbody>
      </table>
    </div>
  );
}

function Th({ label, sortKey, current, asc, onClick, align = "left" }: {
  label: string; sortKey: SortKey; current: SortKey; asc: boolean;
  onClick: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={align === "right" ? "px-2 py-2 text-right" : "px-2 py-2"}>
      <button
        onClick={() => onClick(sortKey)}
        className={"inline-flex items-center gap-1 " + (active ? "text-foreground" : "")}
      >
        {label}
        {active && (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function Row({ row, onClick }: { row: ActiveAgentRow; onClick: () => void }) {
  return (
    <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={onClick}>
      <td className="px-2 py-2 font-medium">{row.agent_name}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground">
        {row.position_code ? `${row.position_code} ${row.position_name}` : "—"}
      </td>
      <td className="px-2 py-2 tabular-nums">{row.last_policy_date}</td>
      <td className="px-2 py-2 text-right tabular-nums">{row.policies_count}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(row.premium_total)}</td>
      <td className="px-2 py-2">
        <Badge variant={row.status === "active" ? "success" : "secondary"}>{row.status}</Badge>
      </td>
    </tr>
  );
}
