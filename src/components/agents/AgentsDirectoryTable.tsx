import type { DirectoryRow } from "@/hooks/useAgentsDirectory";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Props = { rows: DirectoryRow[] };

export function AgentsDirectoryTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No agents yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Position</TableHead>
            <TableHead>Upline</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
            const position = row.current_position_code
              ? `${row.current_position_code} ${row.current_position_name ?? ""}`.trim()
              : "—";
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell className="text-muted-foreground">{row.email}</TableCell>
                <TableCell>
                  {position === "—" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span>{position}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.is_owner ? "—" : (row.upline_email ?? "—")}
                </TableCell>
                <TableCell>
                  {row.is_owner ? (
                    <Badge variant="default">Owner</Badge>
                  ) : row.status === "active" ? (
                    <Badge variant="success">Active</Badge>
                  ) : row.status === "inactive" ? (
                    <Badge variant="warning">Inactive</Badge>
                  ) : (
                    <Badge variant="muted">Archived</Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
