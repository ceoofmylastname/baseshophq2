import { useNavigate } from "react-router-dom";
import { LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
  const { currentAgent, tenant, isOwner, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const displayName =
    [currentAgent?.first_name, currentAgent?.last_name].filter(Boolean).join(" ") ||
    currentAgent?.email ||
    "—";

  return (
    <div className="flex h-full items-center justify-between px-3 sm:px-6">
      {/* Tenant info — full label on desktop, single-line + truncate on mobile */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:inline">
          Tenant
        </span>
        <span className="truncate text-sm font-semibold tracking-tight">{tenant?.name ?? "—"}</span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="ml-2 shrink-0 gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 hover:bg-white/[0.06] hover:border-white/[0.12] sm:gap-2 sm:px-3"
          >
            {/* Hide name on very narrow screens; rely on Owner badge + chevron */}
            <span className="hidden max-w-[120px] truncate text-sm font-medium sm:inline">
              {displayName}
            </span>
            {isOwner && (
              <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Owner
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            <span className="block truncate font-semibold text-foreground sm:hidden">{displayName}</span>
            {currentAgent?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
