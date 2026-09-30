import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Users, Activity } from "lucide-react";
import { format } from "date-fns";

interface CollabStat {
  entry_id: string;
  entry_title: string;
  collaborator_count: number;
}

interface RecentEvent {
  id: string;
  entry_id: string;
  event_type: string;
  metadata: Record<string, any>;
  created_at: string;
}

export default function CollaborationOverviewPanel() {
  const [stats, setStats] = useState<CollabStat[]>([]);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Fetch recent collab events
      const { data: evts } = await supabase
        .from("collaboration_events")
        .select("id, entry_id, event_type, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      setEvents((evts as RecentEvent[]) || []);

      // Fetch projects with collaborators
      const { data: collabs } = await supabase
        .from("project_collaborators")
        .select("entry_id, id");

      if (collabs && collabs.length > 0) {
        const entryMap = new Map<string, number>();
        collabs.forEach((c) => entryMap.set(c.entry_id, (entryMap.get(c.entry_id) || 0) + 1));
        const entryIds = [...entryMap.keys()];

        const { data: entries } = await supabase
          .from("entries")
          .select("id, title")
          .in("id", entryIds);

        const titleMap = new Map(entries?.map((e) => [e.id, e.title]) || []);
        setStats(
          entryIds.map((eid) => ({
            entry_id: eid,
            entry_title: titleMap.get(eid) || "Untitled",
            collaborator_count: entryMap.get(eid) || 0,
          })).sort((a, b) => b.collaborator_count - a.collaborator_count)
        );
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading collaboration data…</p>;

  return (
    <div className="space-y-6">
      {/* Active Collaborations */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" /> Active Collaborations
          <Badge variant="secondary" className="text-[10px]">{stats.length}</Badge>
        </h4>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active collaborations yet.</p>
        ) : (
          <div className="space-y-1">
            {stats.slice(0, 20).map((s) => (
              <div key={s.entry_id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-muted/20">
                <span className="text-sm truncate flex-1">{s.entry_title}</span>
                <Badge variant="outline" className="text-[10px] ml-2">{s.collaborator_count} collaborator{s.collaborator_count !== 1 ? "s" : ""}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Events */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> Recent Activity
        </h4>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No collaboration events yet.</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-2 py-1 px-2">
                <span className="text-[10px] text-muted-foreground/60 font-mono whitespace-nowrap mt-0.5">
                  {format(new Date(e.created_at), "MMM d, HH:mm")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.event_type.replace(/_/g, " ")}
                  {e.metadata?.collaborator_name && ` — ${e.metadata.collaborator_name}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
