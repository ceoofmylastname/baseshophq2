import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { realtimeTopic } from "@/lib/realtime-topic";
import { useTenant } from "@/contexts/AuthContext";

export type OrgChartRange = "day" | "week" | "month" | "year";

export type OrgChartRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
  title: string | null;
  upline_agent_id: string | null;
  is_owner: boolean;
  position_code: string | null;
  position_name: string | null;
  in_window_count: number;
  issue_paid_count: number;
  submitted_pending_count: number;
  at_risk_count: number;
  lifetime_count: number;
};

export type OrgChartNode = OrgChartRow & {
  children: OrgChartNode[];
  /** Computed: any descendant (or self) has at_risk_count > 0 in window. */
  subtreeHasRisk: boolean;
  /** Computed: total lifetime policy count for self + entire subtree. */
  subtreeLifetimeCount: number;
  /** Computed: total in-window policy count for self + entire subtree. */
  subtreeInWindowCount: number;
  /** 0 for roots, 1 for direct reports, etc. */
  depth: number;
};

export type ActivityTier =
  | "issue_paid"           // emerald — strongest: has cash in the door this window
  | "active"               // gold    — wrote business in window (any status)
  | "inactive_with_history"// zinc    — dormant: has lifetime business but nothing in window
  | "never_written";       // muted   — fresh: no business ever

export function activityTier(node: OrgChartRow): ActivityTier {
  if (node.issue_paid_count > 0)  return "issue_paid";
  if (node.in_window_count > 0)   return "active";
  if (node.lifetime_count > 0)    return "inactive_with_history";
  return "never_written";
}

/**
 * Resolve a window preset to an inclusive [start, end] date pair.
 * Day=today only; Week=Monday of this week through today;
 * Month=1st of this month through today; Year=Jan 1 through today.
 */
function rangeDates(range: OrgChartRange): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  if (range === "day") {
    start = new Date(end);
  } else if (range === "week") {
    // ISO-style: Monday as week start. JS getDay(): Sun=0 Mon=1 ... Sat=6.
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    start = new Date(end);
    start.setDate(end.getDate() - (dow - 1));
  } else if (range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

/**
 * Assemble flat RPC rows into a forest of trees, computing subtree
 * aggregates in a single post-order traversal.
 *
 * If multiple roots exist (the caller is owner-of-tenant and there are
 * multiple top-level owners, or in non-owner view the caller is a root by
 * definition), they all show up. Typically returns 1 root.
 */
function buildForest(rows: OrgChartRow[]): OrgChartNode[] {
  const byId = new Map<string, OrgChartNode>();
  for (const r of rows) {
    byId.set(r.id, {
      ...r,
      children: [],
      subtreeHasRisk: false,
      subtreeLifetimeCount: 0,
      subtreeInWindowCount: 0,
      depth: 0,
    });
  }
  const roots: OrgChartNode[] = [];
  for (const node of byId.values()) {
    if (node.upline_agent_id && byId.has(node.upline_agent_id)) {
      byId.get(node.upline_agent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort siblings: writers first (in-window desc), then alphabetical fallback.
  const sortChildren = (nodes: OrgChartNode[]) => {
    nodes.sort((a, b) => {
      if (b.in_window_count !== a.in_window_count) return b.in_window_count - a.in_window_count;
      const an = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || a.email;
      const bn = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || b.email;
      return an.localeCompare(bn);
    });
    for (const n of nodes) sortChildren(n.children);
  };
  sortChildren(roots);

  // Post-order: compute subtree aggregates + assign depth.
  const visit = (node: OrgChartNode, depth: number) => {
    node.depth = depth;
    let risk = node.at_risk_count > 0;
    let life = node.lifetime_count;
    let win  = node.in_window_count;
    for (const c of node.children) {
      visit(c, depth + 1);
      risk = risk || c.subtreeHasRisk;
      life += c.subtreeLifetimeCount;
      win  += c.subtreeInWindowCount;
    }
    node.subtreeHasRisk = risk;
    node.subtreeLifetimeCount = life;
    node.subtreeInWindowCount = win;
  };
  for (const r of roots) visit(r, 0);

  return roots;
}

export function useAgentsOrgChart(args: { range: OrgChartRange }) {
  const tenant = useTenant();
  const [rows, setRows] = useState<OrgChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwnerView, setIsOwnerView] = useState(false);

  const { start, end } = useMemo(() => rangeDates(args.range), [args.range]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.rpc("agents_org_chart", {
      p_start_date: start,
      p_end_date:   end,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const r = data as { success: boolean; error_code?: string; is_owner_view?: boolean; rows?: OrgChartRow[] };
    if (!r?.success) { setError(r?.error_code ?? "unknown"); return; }
    setError(null);
    setIsOwnerView(Boolean(r.is_owner_view));
    setRows((r.rows ?? []).map(row => ({
      ...row,
      in_window_count:         Number(row.in_window_count),
      issue_paid_count:        Number(row.issue_paid_count),
      submitted_pending_count: Number(row.submitted_pending_count),
      at_risk_count:           Number(row.at_risk_count),
      lifetime_count:          Number(row.lifetime_count),
    })));
  }, [start, end]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: re-fetch on any policy or agents table change.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(realtimeTopic(`org-chart-${tenant.id}`))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "policies", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `tenant_id=eq.${tenant.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [tenant?.id, refresh]);

  const forest = useMemo(() => buildForest(rows), [rows]);

  return { forest, rows, loading, error, isOwnerView, refresh };
}
