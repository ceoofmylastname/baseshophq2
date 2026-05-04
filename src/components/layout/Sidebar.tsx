import { NavLink } from "react-router-dom";
import { Home, Users, BarChart3, FileText, Settings, Upload, Wallet } from "lucide-react";
import { useIsOwner } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/**
 * Phase 5 nav: 5 items. Owner-only items hidden from non-owners.
 *
 * TODO (Phases 6+): expand to the full nav from Wiki/baseshop-hq-overview.md:
 *   Home
 *   Agents → Directory, Active Agents, Positions, Contracts
 *   Policies → Post a Deal, Drafts, Book, Scoreboard, Production, Team Production
 *   Carrier Reports
 *   Payroll
 *   System → Settings, Positions, Carriers, Integrations, Authenticated Links
 * Each section will collapse and expand.
 */

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  ownerOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/agents",    label: "Agents",    icon: Users },
  { to: "/master-grid", label: "Master Grid", icon: BarChart3, ownerOnly: true },
  { to: "/ingest",    label: "Ingest",    icon: Upload, ownerOnly: true },
  { to: "/policies",  label: "Policies",  icon: FileText },
  { to: "/my-rates",  label: "My Rates",  icon: Wallet },
  { to: "/settings",  label: "Settings",  icon: Settings },
];

export function Sidebar() {
  const isOwner = useIsOwner();
  const items = NAV.filter((i) => !i.ownerOnly || isOwner);

  return (
    <nav className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="text-base font-semibold">Baseshop HQ</div>
      </div>
      <ul className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
