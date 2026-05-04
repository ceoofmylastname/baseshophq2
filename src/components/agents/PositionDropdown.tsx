import { useCompGridPositions, type GridPosition } from "@/hooks/useCompGridPositions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  currentPositionId: string | null;
  onSelect: (position: GridPosition) => void;
  disabled?: boolean;
};

export function PositionDropdown({ currentPositionId, onSelect, disabled }: Props) {
  const { positions, loading } = useCompGridPositions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || loading}>
          Change position
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Assign to position</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {positions.length === 0 ? (
          <DropdownMenuItem disabled>No positions available</DropdownMenuItem>
        ) : (
          positions.map((p) => (
            <DropdownMenuItem
              key={p.id}
              disabled={p.id === currentPositionId}
              onSelect={() => onSelect(p)}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{p.position_code}</span>
              <span>{p.position_name}</span>
              {p.id === currentPositionId && (
                <span className="ml-auto text-xs text-muted-foreground">(current)</span>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
