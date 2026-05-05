import { useState } from "react";
import { ScoreboardTopProducers } from "./ScoreboardTopProducers";
import { ScoreboardTopEarners } from "./ScoreboardTopEarners";
import { ScoreboardTopRecruiters } from "./ScoreboardTopRecruiters";
import { ScoreboardMostImproved } from "./ScoreboardMostImproved";
import { cn } from "@/lib/utils";

type Tab = "producers" | "earners" | "recruiters" | "improved";

type Props = {
  startDate: string;
  endDate: string;
  carrierId: string | null;
  visibleAgentIds: Set<string>;
};

export function ScoreboardTabs({ startDate, endDate, carrierId, visibleAgentIds }: Props) {
  const [tab, setTab] = useState<Tab>("producers");
  return (
    <div className="rounded-md border bg-card p-4">
      <nav className="flex gap-1 border-b">
        <TabBtn active={tab === "producers"} onClick={() => setTab("producers")}>Top Producers</TabBtn>
        <TabBtn active={tab === "earners"} onClick={() => setTab("earners")}>Top Earners</TabBtn>
        <TabBtn active={tab === "recruiters"} onClick={() => setTab("recruiters")}>Top Recruiters</TabBtn>
        <TabBtn active={tab === "improved"} onClick={() => setTab("improved")}>Most Improved</TabBtn>
      </nav>
      <div className="mt-3">
        {tab === "producers" && (
          <ScoreboardTopProducers
            startDate={startDate} endDate={endDate} carrierId={carrierId}
            visibleAgentIds={visibleAgentIds}
          />
        )}
        {tab === "earners" && (
          <ScoreboardTopEarners
            startDate={startDate} endDate={endDate} carrierId={carrierId}
            visibleAgentIds={visibleAgentIds}
          />
        )}
        {tab === "recruiters" && (
          <ScoreboardTopRecruiters
            startDate={startDate} endDate={endDate}
            visibleAgentIds={visibleAgentIds}
          />
        )}
        {tab === "improved" && (
          <ScoreboardMostImproved
            startDate={startDate} endDate={endDate} carrierId={carrierId}
            visibleAgentIds={visibleAgentIds}
          />
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
