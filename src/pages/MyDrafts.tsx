import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, FileText, Pencil, Trash2, Plus, ChevronDown, ChevronRight, History } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAuthDecision } from "@/lib/authAudit";
import { Progress } from "@/components/ui/progress";
import { WritingProgressCard } from "@/components/profile/WritingProgressCard";
import { computeCompletionPct, targetPagesFor } from "@/lib/writingProgress";

type Draft = {
  id: string;
  title: string;
  format: string | null;
  genre: string | null;
  page_count: number;
  scene_count: number;
  last_edited_at: string;
  created_at: string;
  target_page_count: number | null;
  total_words: number | null;
};

type Version = {
  id: string;
  source: string;
  page_count: number;
  created_at: string;
  title: string | null;
};

export default function MyDrafts() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameOriginal, setRenameOriginal] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth?redirect=/my-drafts");
  }, [authLoading, user, navigate]);

  // Phase B: read drafts directly from screenplay_drafts (title + metadata
  // shell). The fountain body has moved to project_artifacts and is fetched
  // on demand by the editor via readFountain(). The sunset view
  // v_screenplays_unified has been dropped.
  const loadDrafts = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("screenplay_drafts")
      .select(
        "id,title,format,genre,page_count,scene_count,last_edited_at,created_at,target_page_count,total_words"
      )
      .eq("user_id", user.id)
      .order("last_edited_at", { ascending: false });
    if (error) {
      toast.error("Failed to load drafts");
      setDrafts([]);
    } else {
      const rows = ((data as any[]) ?? []).map((r) => ({
        id: r.id as string,
        title: (r.title as string) ?? "Untitled",
        format: (r.format as string) ?? null,
        genre: (r.genre as string) ?? null,
        page_count: (r.page_count as number) ?? 0,
        scene_count: (r.scene_count as number) ?? 0,
        last_edited_at: (r.last_edited_at as string) ?? (r.created_at as string),
        created_at: (r.created_at as string),
        target_page_count: (r.target_page_count as number) ?? null,
        total_words: (r.total_words as number) ?? null,
      })) as Draft[];
      setDrafts(rows);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleVersions = async (draftId: string) => {
    const next = !expanded[draftId];
    setExpanded((p) => ({ ...p, [draftId]: next }));
    if (next && !versions[draftId]) {
      const { data, error } = await supabase
        .from("screenplay_draft_versions")
        .select("id,source,page_count,created_at,title")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) toast.error("Failed to load versions");
      else setVersions((p) => ({ ...p, [draftId]: (data as Version[]) || [] }));
    }
  };

  const startRename = (d: Draft) => {
    setRenamingId(d.id);
    setRenameValue(d.title);
    setRenameOriginal(d.title);
  };

  const saveRename = async (id: string) => {
    if (!user) return;
    const newTitle = renameValue.trim();
    if (!newTitle) {
      toast.error("Title cannot be empty");
      return;
    }
    const { data, error } = await supabase
      .from("screenplay_drafts")
      .update({ title: newTitle })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      logAuthDecision("draft_rename", "denied", {
        resource: `screenplay_drafts:${id}`,
        reason: error?.message ?? "not owner or not found",
        draftId: id,
        before: renameOriginal,
        after: newTitle,
      });
      toast.error("Rename failed");
    } else {
      logAuthDecision("draft_rename", "granted", {
        resource: `screenplay_drafts:${id}`,
        draftId: id,
        before: renameOriginal,
        after: newTitle,
      });
      setDrafts((p) => p.map((d) => (d.id === id ? { ...d, title: newTitle } : d)));
      toast.success("Renamed");
    }
    setRenamingId(null);
    setRenameOriginal("");
  };

  const confirmDelete = async () => {
    if (!deleteId || !user) return;
    const id = deleteId;
    const original = drafts.find((d) => d.id === id);
    setDeleteId(null);
    const { data, error } = await supabase
      .from("screenplay_drafts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      logAuthDecision("draft_delete", "denied", {
        resource: `screenplay_drafts:${id}`,
        reason: error?.message ?? "not owner or not found",
        draftId: id,
        before: original?.title,
      });
      toast.error("Delete failed");
    } else {
      logAuthDecision("draft_delete", "granted", {
        resource: `screenplay_drafts:${id}`,
        draftId: id,
        before: original?.title,
      });
      setDrafts((p) => p.filter((d) => d.id !== id));
      toast.success("Draft deleted");
    }
  };

  return (
    <Layout>
      <div className="container mx-auto max-w-5xl py-10 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl md:text-4xl text-foreground">My Drafts</h1>
            <p className="text-muted-foreground font-body mt-1">
              Your in-progress screenplays and version history.
            </p>
          </div>
          <Button asChild>
            <Link to="/write">
              <Plus className="w-4 h-4 mr-2" /> New Draft
            </Link>
          </Button>
        </div>
        <div className="mb-6">
          <WritingProgressCard userId={user?.id} />
        </div>


        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
              <p className="font-body text-foreground mb-1">No drafts yet</p>
              <p className="text-sm text-muted-foreground mb-6">
                Start writing or generate a first draft from a Brain Dump brief.
              </p>
              <Button asChild>
                <Link to="/write">
                  <Plus className="w-4 h-4 mr-2" /> Start a Draft
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => {
              const isOpen = expanded[d.id];
              const vs = versions[d.id];
              return (
                <Card key={d.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        {renamingId === d.id ? (
                          <div className="flex gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRename(d.id);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              autoFocus
                              className="h-9"
                            />
                            <Button size="sm" onClick={() => saveRename(d.id)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Link
                            to={`/write?draft=${d.id}`}
                            className="font-display text-lg text-foreground hover:text-primary truncate block"
                          >
                            {d.title || "Untitled"}
                          </Link>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground font-body">
                          {d.format && <Badge variant="secondary">{d.format}</Badge>}
                          {d.genre && <span>{d.genre}</span>}
                          <span>•</span>
                          <span>{d.page_count} pages</span>
                          <span>•</span>
                          <span>{d.scene_count} scenes</span>
                          {(d.total_words ?? 0) > 0 && (
                            <>
                              <span>•</span>
                              <span>{d.total_words} words</span>
                            </>
                          )}
                          <span>•</span>
                          <span>
                            Edited {formatDistanceToNow(new Date(d.last_edited_at), { addSuffix: true })}
                          </span>
                        </div>
                        {(() => {
                          const target = targetPagesFor(d.format, d.target_page_count);
                          const pct = computeCompletionPct(d.page_count, target);
                          return (
                            <div className="mt-2 flex items-center gap-2">
                              <Progress value={pct} className="h-1.5 flex-1 max-w-xs" />
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {pct}% of {target}pp
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => toggleVersions(d.id)}>
                          {isOpen ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                          <History className="w-4 h-4 mr-1" /> Versions
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/write?draft=${d.id}`}>Open</Link>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => startRename(d)} aria-label="Rename">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(d.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 border-t border-border pt-3">
                        {!vs ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading versions…
                          </div>
                        ) : vs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No version snapshots yet.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {vs.map((v) => (
                              <li
                                key={v.id}
                                className="flex items-center justify-between text-sm font-body text-muted-foreground"
                              >
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[10px] uppercase">
                                    {v.source}
                                  </Badge>
                                  <span>{v.title || "Untitled"}</span>
                                  <span className="text-xs">• {v.page_count}p</span>
                                </div>
                                <span className="text-xs">
                                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the draft and all its version snapshots. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
