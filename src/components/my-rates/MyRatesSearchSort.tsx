import { Input } from "@/components/ui/input";

export type SortMode = "carrier_az" | "rate_desc" | "rate_asc";

type Props = {
  search: string;
  onSearchChange: (s: string) => void;
  sort: SortMode;
  onSortChange: (s: SortMode) => void;
};

export function MyRatesSearchSort({ search, onSearchChange, sort, onSortChange }: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        type="search"
        placeholder="Search carrier or product…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="sm:max-w-sm"
      />
      <div className="flex flex-wrap gap-1 text-xs">
        <SortButton label="A-Z carrier" active={sort === "carrier_az"} onClick={() => onSortChange("carrier_az")} />
        <SortButton label="Highest %" active={sort === "rate_desc"} onClick={() => onSortChange("rate_desc")} />
        <SortButton label="Lowest %" active={sort === "rate_asc"} onClick={() => onSortChange("rate_asc")} />
      </div>
    </div>
  );
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-primary px-2 py-1 text-primary-foreground"
          : "rounded-md border px-2 py-1 text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}
