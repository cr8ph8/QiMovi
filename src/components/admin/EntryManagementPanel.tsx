import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ClipboardList, Search, Sparkles, Eye, EyeOff, Link2, Shield, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ENTRY_STATUSES = ["submitted", "under_review", "shortlisted", "accepted", "judging", "scored", "error", "disqualified"] as const;

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-muted text-muted-foreground",
  under_review: "bg-blue-500/10 text-blue-500",
  shortlisted: "bg-amber-500/10 text-amber-500",
  accepted: "bg-emerald-500/10 text-emerald-500",
  judging: "bg-primary/10 text-primary",
  scored: "bg-primary/20 text-primary",
  error: "bg-destructive/10 text-destructive",
  disqualified: "bg-destructive/10 text-destructive",
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  shortlisted: "Shortlisted",
  accepted: "Accepted",
  judging: "Judging",
  scored: "Scored",
  error: "Error",
  disqualified: "Disqualified",
};

interface EntryRow {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  author: string | null;
  page_count: number | null;
  length_category: string | null;
  created_at: string;
  user_id: string;
  competition_id: string;
  visibility: string;
  sensitivity: string;
  embargo_until: string | null;
}

export default function EntryManagementPanel() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [judging, setJudging] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("entries")
      .select("id, title, status, genre, author, page_count, length_category, created_at, user_id, competition_id, visibility, sensitivity, embargo_until")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setEntries((data as EntryRow[]) || []);
        setLoading(false);
      });
  }, []);

  async function handleStatusChange(entryId: string, newStatus: string) {
    setUpdating(entryId);
    // Use service-level update via admin RLS policy
    const { error } = await supabase
      .from("entries")
      .update({ status: newStatus as any })
      .eq("id", entryId);

    setUpdating(null);
    if (error) {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: newStatus } : e)));
      toast({ title: `Entry set to ${STATUS_LABELS[newStatus] || newStatus}` });
    }
  }

  async function handleVisibilityChange(entryId: string, newVisibility: string) {
    setUpdating(entryId);
    const { error } = await supabase
      .from("entries")
      .update({ visibility: newVisibility as any })
      .eq("id", entryId);
    setUpdating(null);
    if (error) {
      toast({ title: "Failed to update visibility", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, visibility: newVisibility } : e)));
      toast({ title: `Visibility set to ${newVisibility}` });
    }
  }

  async function handleSensitivityChange(entryId: string, newSensitivity: string) {
    setUpdating(entryId);
    const { error } = await supabase
      .from("entries")
      .update({ sensitivity: newSensitivity } as any)
      .eq("id", entryId);
    setUpdating(null);
    if (error) {
      toast({ title: "Failed to update sensitivity", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, sensitivity: newSensitivity } : e)));
      toast({ title: `Sensitivity set to ${newSensitivity}` });
    }
  }

  async function handleEmbargoChange(entryId: string, embargoDate: string | null) {
    setUpdating(entryId);
    const { error } = await supabase
      .from("entries")
      .update({ embargo_until: embargoDate } as any)
      .eq("id", entryId);
    setUpdating(null);
    if (error) {
      toast({ title: "Failed to update embargo", description: error.message, variant: "destructive" });
    } else {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, embargo_until: embargoDate } : e)));
      toast({ title: embargoDate ? `Embargoed until ${new Date(embargoDate).toLocaleDateString()}` : "Embargo removed" });
    }
  }

  async function handleRetryJudge(entryId: string) {
    setJudging(entryId);
    // Reset status to submitted first
    const { error: resetErr } = await supabase
      .from("entries")
      .update({ status: "submitted" as any })
      .eq("id", entryId);
    if (resetErr) {
      toast({ title: "Failed to reset status", description: resetErr.message, variant: "destructive" });
      setJudging(null);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "judging" } : e)));
    try {
      const { error } = await supabase.functions.invoke("ai-judge", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "scored" } : e)));
      toast({ title: "Entry re-judged successfully" });
    } catch (err: any) {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "submitted" } : e)));
      toast({ title: "Retry judging failed", description: err.message, variant: "destructive" });
    }
    setJudging(null);
  }

  async function handleJudge(entryId: string) {
    setJudging(entryId);
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "judging" } : e)));
    try {
      const { error } = await supabase.functions.invoke("ai-judge", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "scored" } : e)));
      toast({ title: "Entry judged successfully" });
    } catch (err: any) {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "submitted" } : e)));
      toast({ title: "Judging failed", description: err.message, variant: "destructive" });
    }
    setJudging(null);
  }

  const filtered = entries.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.author?.toLowerCase().includes(q) ||
        e.genre?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Status counts
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.status] = (counts[e.status] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-semibold">Entry Management</h3>
        <span className="text-xs text-muted-foreground font-mono ml-auto">{entries.length} entries</span>
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
            statusFilter === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All ({entries.length})
        </button>
        {ENTRY_STATUSES.map((s) => (
          counts[s] ? (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? "all" : s)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                statusFilter === s ? STATUS_STYLES[s] : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[s]} ({counts[s]})
            </button>
          ) : null
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, author, or genre..."
          className="pl-9 h-9 text-sm bg-muted border-border"
        />
      </div>

      {/* Entries list */}
      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No entries found.</div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="divide-y divide-border/30">
              {filtered.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-sm font-semibold truncate">{entry.title}</h4>
                      <Badge variant="outline" className={`text-[9px] font-mono shrink-0 ${STATUS_STYLES[entry.status] || ""}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      {entry.author && <span>{entry.author}</span>}
                      {entry.genre && <span>· {entry.genre}</span>}
                      {entry.page_count && <span>· {entry.page_count}p</span>}
                      {entry.length_category && <span className="capitalize">· {entry.length_category}</span>}
                      <span>· {new Date(entry.created_at).toLocaleDateString()}</span>
                      {entry.sensitivity && entry.sensitivity !== "standard" && (
                        <Badge variant="outline" className="text-[9px] font-mono bg-amber-500/10 text-amber-500 border-amber-500/20">
                          <Shield className="h-2.5 w-2.5 mr-0.5" />{entry.sensitivity}
                        </Badge>
                      )}
                      {entry.embargo_until && new Date(entry.embargo_until) > new Date() && (
                        <Badge variant="outline" className="text-[9px] font-mono bg-blue-500/10 text-blue-500 border-blue-500/20">
                          <Clock className="h-2.5 w-2.5 mr-0.5" />Until {new Date(entry.embargo_until).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {entry.status === "submitted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs font-mono shrink-0 h-8"
                      disabled={judging === entry.id}
                      onClick={() => handleJudge(entry.id)}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {judging === entry.id ? "Judging…" : "Judge"}
                    </Button>
                  )}
                  {(entry.status === "judging" || entry.status === "error") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`text-xs font-mono shrink-0 h-8 ${
                        entry.status === "error"
                          ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                          : "border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                      }`}
                      disabled={judging === entry.id}
                      onClick={() => handleRetryJudge(entry.id)}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {judging === entry.id ? "Retrying…" : "Retry"}
                    </Button>
                  )}
                  <Select
                    value={entry.sensitivity || "standard"}
                    onValueChange={(v) => handleSensitivityChange(entry.id, v)}
                    disabled={updating === entry.id}
                  >
                    <SelectTrigger className="w-[120px] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard" className="text-xs">Standard</SelectItem>
                      <SelectItem value="confidential" className="text-xs">Confidential</SelectItem>
                      <SelectItem value="nda_protected" className="text-xs">NDA Protected</SelectItem>
                      <SelectItem value="embargoed" className="text-xs">Embargoed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 p-0" title="Set embargo date">
                        <Clock className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="end">
                      <div className="space-y-2">
                        <p className="text-xs font-mono text-muted-foreground">Embargo Until</p>
                        <input
                          type="date"
                          className="text-xs border rounded px-2 py-1 bg-background"
                          value={entry.embargo_until ? new Date(entry.embargo_until).toISOString().split("T")[0] : ""}
                          onChange={(e) => handleEmbargoChange(entry.id, e.target.value ? new Date(e.target.value).toISOString() : null)}
                        />
                        {entry.embargo_until && (
                          <Button size="sm" variant="ghost" className="text-xs w-full" onClick={() => handleEmbargoChange(entry.id, null)}>
                            Clear Embargo
                          </Button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Select
                    value={entry.visibility || "default"}
                    onValueChange={(v) => handleVisibilityChange(entry.id, v)}
                    disabled={updating === entry.id}
                  >
                    <SelectTrigger className="w-[100px] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="text-xs">
                        <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> Default</span>
                      </SelectItem>
                      <SelectItem value="private" className="text-xs">
                        <span className="flex items-center gap-1"><EyeOff className="h-3 w-3" /> Private</span>
                      </SelectItem>
                      <SelectItem value="unlisted" className="text-xs">
                        <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> Unlisted</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={entry.status}
                    onValueChange={(v) => handleStatusChange(entry.id, v)}
                    disabled={updating === entry.id}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTRY_STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
