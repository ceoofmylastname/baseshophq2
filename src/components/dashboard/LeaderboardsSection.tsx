import { useState } from "react";
import { LeaderboardTopProducers } from "./LeaderboardTopProducers";
import { LeaderboardTopRecruiters } from "./LeaderboardTopRecruiters";
import { LeaderboardMostImproved } from "./LeaderboardMostImproved";
import { cn } from "@/lib/utils";

type Tab = "producers" | "recruiters" | "improved";

type Props = { startDate: string; endDate: string; carrierId: string | null };

export function LeaderboardsSection({ startDate, endDate, carrierId }: Props) {
  const [tab, setTab] = useState<Tab>("producers");
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Leaderboards</h3>
      </div>
      <nav className="mt-2 flex gap-1 border-b">
        <TabBtn id="producers" active={tab === "producers"} onClick={() => setTab("producers")}>Top Producers</TabBtn>
        <TabBtn id="recruiters" active={tab === "recruiters"} onClick={() => setTab("recruiters")}>Top Recruiters</TabBtn>
        <TabBtn id="improved" active={tab === "improved"} onClick={() => setTab("improved")}>Most Improved</TabBtn>
      </nav>
      <div className="mt-3">
        {tab === "producers" && <LeaderboardTopProducers startDate={startDate} endDate={endDate} carrierId={carrierId} />}
        {tab === "recruiters" && <LeaderboardTopRecruiters startDate={startDate} endDate={endDate} />}
        {tab === "improved" && <LeaderboardMostImproved startDate={startDate} endDate={endDate} carrierId={carrierId} />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { id: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-1.5 text-xs transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
