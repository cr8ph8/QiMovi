import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Shield,
  Check,
  X,
  RotateCcw,
  Search,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

interface QueueRow {
  id: string;
  brief_id: string;
  brief_title: string | null;
  parent_comment_id: string | null;
  author_name: string;
  body: string;
  moderation_flags: string[] | null;
  moderation_score: number | null;
  hidden: boolean;
  pending_approval: boolean;
  report_count: number;
  created_at: string;
}

interface BriefOption {
  brief_id: string;
  title: string | null;
  comment_count: number;
  pending_count: number;
}

const STATUSES = [
  { value: "pending", label: "Pending review" },
  { value: "flagged", label: "Auto-flagged" },
  { value: "reported", label: "User-reported" },
  { value: "hidden", label: "Hidden" },
  { value: "approved", label: "Approved" },
  { value: "all", label: "All" },
];

const SORTS = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "score_asc", label: "Lowest confidence" },
  { value: "score_desc", label: "Highest confidence" },
  { value: "reports_desc", label: "Most reported" },
];

const PAGE_SIZE = 50;

export default function ModerationQueue() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [briefs, setBriefs] = useState<BriefOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkActing, setBulkActing] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [status, setStatus] = useState("pending");
  const [briefId, setBriefId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [minScore, setMinScore] = useState<string>("");
  const [maxScore, setMaxScore] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user);
      setAuthChecked(true);
      if (!data.user) navigate("/auth");
    });
  }, [navigate]);

  const loadBriefs = async () => {
    const { data, error } = await supabase.rpc("list_owner_briefs_with_comments");
    if (!error && Array.isArray(data)) setBriefs(data as BriefOption[]);
  };

  const loadRows = async () => {
    setLoading(true);
    setSelected(new Set());
    const { data, error } = await supabase.rpc("list_owner_moderation_queue", {
      p_status: status,
      p_search: search || null,
      p_brief_id: briefId === "all" ? null : briefId,
      p_min_score: minScore ? Number(minScore) : null,
      p_max_score: maxScore ? Number(maxScore) : null,
      p_sort: sort,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not load queue");
      return;
    }
    setRows((data as QueueRow[]) ?? []);
  };

  useEffect(() => {
    if (!authed) return;
    loadBriefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, status, briefId, search, sort, minScore, maxScore, page]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moderateOne = async (id: string, action: "approve" | "reject" | "reset") => {
    setActingOn(id);
    const { error } = await supabase.rpc("moderate_brief_comment", {
      p_comment_id: id,
      p_action: action,
    });
    setActingOn(null);
    if (error) {
      toast.error(error.message || "Action failed");
      return;
    }
    toast.success(
      action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Re-queued",
    );
    loadRows();
  };

  const bulkAct = async (action: "approve" | "reject" | "reset") => {
    if (selected.size === 0) return;
    setBulkActing(true);
    const { data, error } = await supabase.rpc("bulk_moderate_brief_comments", {
      p_comment_ids: Array.from(selected),
      p_action: action,
    });
    setBulkActing(false);
    if (error) {
      toast.error(error.message || "Bulk action failed");
      return;
    }
    toast.success(`${data ?? 0} comment(s) ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "re-queued"}`);
    loadRows();
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput.trim());
  };

  const totalPending = useMemo(
    () => briefs.reduce((acc, b) => acc + (b.pending_count || 0), 0),
    [briefs],
  );

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link to="/brain-dump">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Brain Dump
                </Link>
              </Button>
            </div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5" /> Comment moderation queue
            </h1>
            <p className="text-sm text-muted-foreground">
              Review reported and auto-flagged comments across your shared briefs.
              {totalPending > 0 && (
                <span className="ml-2">
                  <Badge variant="secondary">{totalPending} pending</Badge>
                </span>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { loadBriefs(); loadRows(); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => { setPage(0); setStatus(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Brief</Label>
                <Select value={briefId} onValueChange={(v) => { setPage(0); setBriefId(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All briefs</SelectItem>
                    {briefs.map((b) => (
                      <SelectItem key={b.brief_id} value={b.brief_id}>
                        {b.title || "Untitled"} ({b.comment_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Sort</Label>
                <Select value={sort} onValueChange={(v) => { setPage(0); setSort(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SORTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <form onSubmit={submitSearch} className="space-y-1">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Body or author…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
              </form>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Min confidence</Label>
                <Input
                  type="number" step={0.05} min={0} max={1}
                  value={minScore}
                  onChange={(e) => { setPage(0); setMinScore(e.target.value); }}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max confidence</Label>
                <Input
                  type="number" step={0.05} min={0} max={1}
                  value={maxScore}
                  onChange={(e) => { setPage(0); setMaxScore(e.target.value); }}
                  placeholder="1.00"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium">
                Results {loading ? "" : `(${rows.length})`}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="default"
                  disabled={!someSelected || bulkActing}
                  onClick={() => bulkAct("approve")}
                >
                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm" variant="destructive"
                  disabled={!someSelected || bulkActing}
                  onClick={() => bulkAct("reject")}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
                <Button
                  size="sm" variant="ghost"
                  disabled={!someSelected || bulkActing}
                  onClick={() => bulkAct("reset")}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-queue
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No comments match these filters.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 px-1">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                  <span className="text-xs text-muted-foreground">
                    {selected.size > 0 ? `${selected.size} selected` : "Select all on page"}
                  </span>
                </div>
                <ul className="space-y-3">
                  {rows.map((c) => {
                    const flags = c.moderation_flags ?? [];
                    const score = c.moderation_score != null ? Number(c.moderation_score) : null;
                    const isSelected = selected.has(c.id);
                    return (
                      <li
                        key={c.id}
                        className={`rounded-md border p-3 space-y-2 transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border/60"}`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOne(c.id)}
                            className="mt-1"
                            aria-label="Select comment"
                          />
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{c.author_name}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {new Date(c.created_at).toLocaleString()}
                                  {" · "}
                                  <span className="text-foreground/70">{c.brief_title || "Untitled brief"}</span>
                                  {c.parent_comment_id ? " · reply" : ""}
                                  {" · "}
                                  {c.hidden
                                    ? "hidden"
                                    : c.pending_approval
                                    ? "pending"
                                    : "approved"}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {c.report_count > 0 && (
                                  <Badge variant="destructive" className="text-[10px]">
                                    {c.report_count} report{c.report_count === 1 ? "" : "s"}
                                  </Badge>
                                )}
                                {score != null && (
                                  <Badge
                                    variant={score < 0.4 ? "destructive" : "secondary"}
                                    className="text-[10px]"
                                  >
                                    conf {score.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
                            {flags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {flags.map((f) => (
                                  <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                                ))}
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {!c.hidden && c.pending_approval && (
                                <Button size="sm" variant="default" disabled={actingOn === c.id}
                                  onClick={() => moderateOne(c.id, "approve")}>
                                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                                </Button>
                              )}
                              {!c.hidden && (
                                <Button size="sm" variant="destructive" disabled={actingOn === c.id}
                                  onClick={() => moderateOne(c.id, "reject")}>
                                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                                </Button>
                              )}
                              {(c.hidden || !c.pending_approval) && (
                                <Button size="sm" variant="ghost" disabled={actingOn === c.id}
                                  onClick={() => moderateOne(c.id, "reset")}>
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-queue
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">Page {page + 1}</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="outline"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      disabled={rows.length < PAGE_SIZE}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
