type Props = {
  value: number;
  onChange: (days: number) => void;
};

const PRESETS = [7, 14, 30, 60, 90];

export function ActiveAgentsDateRange({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Active in last</span>
      <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
        {PRESETS.map((d) => (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={
              d === value
                ? "rounded px-3 py-1 bg-primary text-primary-foreground"
                : "rounded px-3 py-1 text-muted-foreground hover:text-foreground"
            }
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  );
}
