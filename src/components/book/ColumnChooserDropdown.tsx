import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const ALL_COLUMNS = [
  "client_name", "carrier", "product", "policy_number",
  "status", "annual_premium", "agent_name", "application_date", "effective_date",
] as const;
export type ColumnKey = typeof ALL_COLUMNS[number];

const LABELS: Record<ColumnKey, string> = {
  client_name: "Client",
  carrier: "Carrier",
  product: "Product",
  policy_number: "Policy #",
  status: "Status",
  annual_premium: "Annual Premium",
  agent_name: "Writing Agent",
  application_date: "Application",
  effective_date: "Effective",
};

const STORAGE_KEY = "book-columns-v1";

// Defaults per Phase 10B spec: keep Policy Number visible, hide only Effective Date
const DEFAULT_VISIBLE: ColumnKey[] = [
  "client_name", "carrier", "product", "policy_number",
  "status", "annual_premium", "agent_name", "application_date",
];

export function loadVisibleColumns(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as ColumnKey[];
    return parsed.filter((c) => ALL_COLUMNS.includes(c));
  } catch { return DEFAULT_VISIBLE; }
}

type Props = { visible: ColumnKey[]; onChange: (visible: ColumnKey[]) => void };

export function ColumnChooserDropdown({ visible, onChange }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)); } catch { /* noop */ }
  }, [visible]);

  function toggle(c: ColumnKey) {
    onChange(visible.includes(c) ? visible.filter((x) => x !== c) : [...visible, c]);
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Settings2 className="mr-1 h-4 w-4" /> Columns
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover p-2 shadow-md">
            <p className="px-1 pb-1 text-xs uppercase text-muted-foreground">Show columns</p>
            {ALL_COLUMNS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-accent">
                <input type="checkbox" checked={visible.includes(c)} onChange={() => toggle(c)} />
                {LABELS[c]}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const COLUMN_LABELS = LABELS;
