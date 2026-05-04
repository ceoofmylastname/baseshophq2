import { useEffect } from "react";
import { Input } from "@/components/ui/input";

export type RangePreset = "today" | "week" | "month" | "3m" | "6m" | "12m" | "all" | "custom";

export type DateRange = { start: string; end: string };

const STORAGE_KEY = "baseshop-dashboard-range-v1";
const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today", week: "This Week", month: "This Month",
  "3m": "3M", "6m": "6M", "12m": "12M", all: "All", custom: "Custom",
};

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export function rangeFromPreset(preset: RangePreset): DateRange {
  const today = new Date();
  const end = isoDate(today);
  let start: Date;
  switch (preset) {
    case "today":   start = today; break;
    case "week":    start = new Date(today); start.setDate(today.getDate() - 6); break;
    case "month":   start = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case "3m":      start = new Date(today); start.setMonth(today.getMonth() - 3); break;
    case "6m":      start = new Date(today); start.setMonth(today.getMonth() - 6); break;
    case "12m":     start = new Date(today); start.setMonth(today.getMonth() - 12); break;
    case "all":     start = new Date("2020-01-01"); break;
    default:        start = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return { start: isoDate(start), end };
}

type Props = {
  value: { preset: RangePreset; range: DateRange };
  onChange: (next: { preset: RangePreset; range: DateRange }) => void;
};

export function TimeRangeFilter({ value, onChange }: Props) {
  // Persist last choice to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* noop */ }
  }, [value]);

  function pickPreset(p: RangePreset) {
    onChange({ preset: p, range: rangeFromPreset(p) });
  }

  function pickCustom(field: "start" | "end", v: string) {
    const next = { ...value.range, [field]: v };
    onChange({ preset: "custom", range: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {(["today", "week", "month", "3m", "6m", "12m", "all"] as RangePreset[]).map((p) => (
        <button
          key={p}
          onClick={() => pickPreset(p)}
          className={
            value.preset === p
              ? "rounded-full bg-primary px-3 py-1 text-primary-foreground"
              : "rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
      <span className="ml-2 flex items-center gap-1">
        <Input type="date" value={value.range.start} onChange={(e) => pickCustom("start", e.target.value)} className="h-8 w-36" />
        <span className="text-muted-foreground">→</span>
        <Input type="date" value={value.range.end}   onChange={(e) => pickCustom("end", e.target.value)}   className="h-8 w-36" />
      </span>
    </div>
  );
}

export function loadStoredRange(): { preset: RangePreset; range: DateRange } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
