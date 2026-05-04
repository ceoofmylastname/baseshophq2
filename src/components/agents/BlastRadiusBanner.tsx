import { usePositionBlastRadius } from "@/hooks/usePositionBlastRadius";

type Props = {
  agentId: string;
  positionId: string;
};

export function BlastRadiusBanner({ agentId, positionId }: Props) {
  const { data, loading, error } = usePositionBlastRadius(agentId, positionId);

  if (loading) {
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        Calculating blast radius…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Could not load blast radius{error ? ` (${error})` : ""}.
      </div>
    );
  }

  const total = data.life_rates_to_template + data.annuity_rates_to_template;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p>
        <span className="font-medium">{data.life_rates_to_template}</span> life rates and{" "}
        <span className="font-medium">{data.annuity_rates_to_template}</span> annuity rates will
        template at this position{total === 0 ? " (no master grid coverage)" : ""}.
      </p>
      {data.existing_override_count > 0 && (
        <p className="mt-1 text-muted-foreground">
          This agent currently has{" "}
          <span className="font-medium text-foreground">{data.existing_override_count}</span>{" "}
          active override{data.existing_override_count === 1 ? "" : "s"}. Choose how the change
          should treat them below.
        </p>
      )}
    </div>
  );
}
