import { NavLink } from "react-router-dom";
import { Home, LayoutDashboard, Users, BarChart3, FileText, Settings, Upload, Wallet, TrendingUp, LineChart, Trophy, UserCheck, FileSignature } from "lucide-react";
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
  { to: "/home",      label: "Home",      icon: Home },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agents",    label: "Agents",    icon: Users },
  { to: "/contracts", label: "Contracts", icon: FileSignature },
  { to: "/master-grid", label: "Master Grid", icon: BarChart3, ownerOnly: true },
  { to: "/ingest",    label: "Ingest",    icon: Upload, ownerOnly: true },
  { to: "/book-of-business", label: "Book of Business", icon: FileText },
  { to: "/production",      label: "Production",     icon: LineChart },
  { to: "/team-production", label: "Team Production", icon: TrendingUp },
  { to: "/scoreboard", label: "Scoreboard", icon: Trophy },
  { to: "/active-agents", label: "Active Agents", icon: UserCheck },
  { to: "/my-rates",  label: "My Rates",  icon: Wallet },
  { to: "/settings",  label: "Settings",  icon: Settings },
];

export function Sidebar() {
  const isOwner = useIsOwner();
  const items = NAV.filter((i) => !i.ownerOnly || isOwner);

  return (
    <nav className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-4">
        <div className="text-base font-semibold tracking-tight text-shadow-soft">
          Baseshop <span className="text-primary">HQ</span>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 p-3">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                  isActive
                    ? "bg-white/[0.06] text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(38_92%_60%/0.6)]"
                    />
                  )}
                  <item.icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
