import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { PostDealModal } from "./PostDealModal";
import { AddAgentDialog } from "@/components/agents/AddAgentDialog";
import { useAgentsDirectory } from "@/hooks/useAgentsDirectory";

type Props = { onActivity: () => void };

export function QuickActionButtons({ onActivity }: Props) {
  const { isOwner } = useAuth();
  const { rows, refresh } = useAgentsDirectory();
  const [postOpen, setPostOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOwner && (
        <Button onClick={() => setPostOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Post a deal
        </Button>
      )}
      {isOwner && (
        <Button variant="outline" asChild>
          <Link to="/ingest"><Upload className="mr-1 h-4 w-4" /> Import</Link>
        </Button>
      )}
      {isOwner && <AddAgentDialog existingAgents={rows} onAdded={() => { void refresh(); onActivity(); }} />}
      {!isOwner && (
        <Button variant="outline" asChild>
          <Link to="/policies"><Plus className="mr-1 h-4 w-4" /> View policies</Link>
        </Button>
      )}

      <PostDealModal
        open={postOpen}
        onClose={() => setPostOpen(false)}
        onPosted={onActivity}
      />
    </div>
  );
}
