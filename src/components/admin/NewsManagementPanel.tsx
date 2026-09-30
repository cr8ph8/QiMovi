import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Eye, EyeOff, Pin, Calendar, Clock, Archive, Sparkles, Loader2,
} from "lucide-react";

import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { renderNewsMarkdown } from "@/lib/newsMarkdown";
import NewsAiDraftReview, {
  type NewsAiDraft,
} from "./NewsAiDraftReview";
import PublicationClaimsDrawer from "./publication/PublicationClaimsDrawer";

interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string[];
  status: string;
  pinned: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: "announcement", label: "Announcement" },
  { value: "feature_release", label: "Feature Release" },
  { value: "system_update", label: "System Update" },
  { value: "competition", label: "Competition" },
  { value: "legal", label: "Legal" },
  { value: "retirement", label: "Retirement" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted/50 text-muted-foreground border-border/50",
  scheduled: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  published: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  archived: "bg-red-500/15 text-red-400 border-red-500/30",
};

const EMPTY_FORM = {
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  category: "announcement",
  tags: "",
  status: "draft",
  pinned: false,
  publishedAtLocal: "",
};

const toLocalDateTimeInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function NewsManagementPanel() {
  const { user } = useAuth();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NewsArticle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [roadmapOptions, setRoadmapOptions] = useState<
    { id: string; title: string; status: string }[]
  >([]);
  const [draftRoadmapId, setDraftRoadmapId] = useState<string>("");
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [drafting, setDrafting] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<NewsAiDraft | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftSessionId, setDraftSessionId] = useState(0);
  const [gateTarget, setGateTarget] = useState<NewsArticle | null>(null);




  const loadArticles = async () => {
    const { data } = await supabase
      .from("news_articles" as any)
      .select("*")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setArticles((data as any[] || []) as NewsArticle[]);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => {
    loadArticles();
    supabase
      .from("feature_roadmap" as any)
      .select("id, title, status")
      .order("released_at", { ascending: false, nullsFirst: false })
      .order("sort_order", { ascending: true })
      .limit(50)
      .then(({ data }) => setRoadmapOptions((data as any[]) || []));
  }, []);

  const generateSlug = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDraftRoadmapId("");
    setDraftNotes("");
    setEditorOpen(true);
  };

  const handleAiDraft = async () => {
    if (!draftRoadmapId && !draftNotes.trim()) {
      toast.error("Pick a changelog entry or paste some notes first.");
      return;
    }
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "news-draft-suggest",
        {
          body: {
            roadmap_id: draftRoadmapId || undefined,
            changelog: draftNotes.trim() || undefined,
            category: form.category,
          },
        },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const draft = (data as any)?.draft;
      if (!draft) throw new Error("Empty draft returned");
      setPendingDraft({
        title: draft.title,
        excerpt: draft.excerpt,
        body: draft.body,
        category: draft.category,
        tags: Array.isArray(draft.tags) ? draft.tags : undefined,
      });
      setDraftSessionId(Date.now());
      setReviewOpen(true);
      toast.success("Draft ready — review before applying.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate draft");
    } finally {
      setDrafting(false);
    }
  };

  const applyPendingDraft = (selection: NewsAiDraft) => {
    setForm((f) => ({
      ...f,
      title: selection.title ?? f.title,
      slug:
        f.slug ||
        (selection.title ? generateSlug(selection.title) : f.slug),
      excerpt: selection.excerpt ?? f.excerpt,
      body: selection.body ?? f.body,
      category: selection.category ?? f.category,
      tags: Array.isArray(selection.tags) ? selection.tags.join(", ") : f.tags,
    }));
    setReviewOpen(false);
    setPendingDraft(null);
    setDraftSessionId(0);
    toast.success("Draft applied to editor.");
  };




  const openEdit = (article: NewsArticle) => {
    setEditingId(article.id);
    setForm({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      body: article.body,
      category: article.category,
      tags: article.tags.join(", "),
      status: article.status,
      pinned: article.pinned,
      publishedAtLocal: toLocalDateTimeInput(article.published_at),
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (form.status === "scheduled" && !form.publishedAtLocal) {
      toast.error("Pick a publish date for scheduled posts");
      return;
    }
    setSaving(true);

    const slug = form.slug.trim() || generateSlug(form.title);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const now = new Date().toISOString();

    let publishedAt: string | null = null;
    if (form.publishedAtLocal) {
      publishedAt = new Date(form.publishedAtLocal).toISOString();
    } else if (form.status === "published") {
      publishedAt = now;
    }

    const payload: any = {
      title: form.title.trim(),
      slug,
      excerpt: form.excerpt.trim(),
      body: form.body.trim(),
      category: form.category,
      tags,
      status: form.status,
      pinned: form.pinned,
      published_at: publishedAt,
      updated_at: now,
    };

    if (editingId) {
      const { error } = await supabase
        .from("news_articles" as any)
        .update(payload)
        .eq("id", editingId);
      if (error) {
        toast.error("Failed to update article");
        setSaving(false);
        return;
      }
      toast.success("Article updated");
    } else {
      payload.created_by = user?.id || null;
      const { error } = await supabase
        .from("news_articles" as any)
        .insert(payload);
      if (error) {
        toast.error(`Failed to create: ${error.message}`);
        setSaving(false);
        return;
      }
      toast.success("Article created");
    }

    setSaving(false);
    setEditorOpen(false);
    loadArticles();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await supabase
      .from("news_articles" as any)
      .delete()
      .eq("id", deleteTarget.id);
    toast.success("Article deleted");
    setDeleting(false);
    setDeleteTarget(null);
    loadArticles();
  };

  const togglePin = async (article: NewsArticle) => {
    await supabase
      .from("news_articles" as any)
      .update({ pinned: !article.pinned } as any)
      .eq("id", article.id);
    setArticles((prev) =>
      prev.map((a) => (a.id === article.id ? { ...a, pinned: !a.pinned } : a))
    );
    toast.success(article.pinned ? "Unpinned" : "Pinned");
  };

  const togglePublish = async (article: NewsArticle) => {
    if (article.status !== "published") {
      // Route publish through the Hampton PLC claims gate.
      setGateTarget(article);
      return;
    }
    // Unpublish path is not claim-gated; use rollback ledger event.
    const now = new Date().toISOString();
    await supabase
      .from("news_articles" as any)
      .update({ status: "draft", updated_at: now })
      .eq("id", article.id);
    try {
      await supabase.functions.invoke("publication-gate", {
        body: {
          action: "rollback",
          surface: "news_article",
          record_id: article.id,
          reason: "unpublished via NewsManagementPanel",
        },
      });
    } catch {
      /* ledger write is best-effort */
    }
    setArticles((prev) =>
      prev.map((a) => (a.id === article.id ? { ...a, status: "draft" } : a)),
    );
    toast.success("Unpublished");
  };

  const filteredArticles = useMemo(() => {
    if (filter === "all") return articles;
    return articles.filter((a) => a.status === filter);
  }, [articles, filter]);

  const allSelected =
    filteredArticles.length > 0 &&
    filteredArticles.every((a) => selected.has(a.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredArticles.map((a) => a.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkUpdate = async (changes: Record<string, any>, label: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("news_articles" as any)
      .update({ ...changes, updated_at: new Date().toISOString() })
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(`Bulk action failed: ${error.message}`);
      return;
    }
    toast.success(`${label} ${ids.length} article${ids.length === 1 ? "" : "s"}`);
    loadArticles();
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("news_articles" as any)
      .delete()
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success(`Deleted ${ids.length} article${ids.length === 1 ? "" : "s"}`);
    loadArticles();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground font-mono">
            {articles.length} articles
          </p>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New Article
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg border border-primary/30 bg-primary/5">
          <p className="text-xs font-mono text-primary">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy || selected.size !== 1}
              onClick={() => {
                const id = Array.from(selected)[0];
                const article = articles.find((a) => a.id === id);
                if (article) setGateTarget(article);
              }}
              title={selected.size === 1 ? "Route through claims gate" : "Bulk publish disabled — gate per-record"}
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" /> Publish
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={() => bulkUpdate({ status: "archived" }, "Archived")}
            >
              <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={() => bulkUpdate({ pinned: true }, "Pinned")}
            >
              <Pin className="h-3.5 w-3.5 mr-1.5" /> Pin
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={() => bulkUpdate({ pinned: false }, "Unpinned")}
            >
              <Pin className="h-3.5 w-3.5 mr-1.5 opacity-50" /> Unpin
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={bulkDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* List header */}
      {filteredArticles.length > 0 && (
        <div className="flex items-center gap-3 px-4">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleSelectAll}
          />
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Select all
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filteredArticles.map((article) => {
          const isScheduled = article.status === "scheduled";
          const futurePublish =
            article.published_at &&
            new Date(article.published_at).getTime() > Date.now();
          return (
            <div
              key={article.id}
              className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/80 hover:bg-card transition-colors"
            >
              <Checkbox
                checked={selected.has(article.id)}
                onCheckedChange={() => toggleSelectOne(article.id)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-mono ${STATUS_COLORS[article.status] || ""}`}
                  >
                    {article.status}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono text-muted-foreground"
                  >
                    {article.category.replace("_", " ")}
                  </Badge>
                  {article.pinned && (
                    <Pin className="h-3 w-3 text-primary" />
                  )}
                  {(isScheduled || futurePublish) && article.published_at && (
                    <span className="text-[10px] font-mono text-sky-400 inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Scheduled for{" "}
                      {format(new Date(article.published_at), "MMM d, HH:mm")}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold truncate">{article.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {article.excerpt}
                </p>
                {article.published_at && !isScheduled && !futurePublish && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 inline mr-1" />
                    {format(new Date(article.published_at), "MMM d, yyyy")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePin(article)}
                  title={article.pinned ? "Unpin" : "Pin"}
                >
                  <Pin
                    className={`h-3.5 w-3.5 ${article.pinned ? "text-primary" : "text-muted-foreground"}`}
                  />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePublish(article)}
                  title={
                    article.status === "published" ? "Unpublish" : "Publish"
                  }
                >
                  {article.status === "published" ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(article)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleteTarget(article)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editor Sheet */}
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit Article" : "New Article"}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-5">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-mono uppercase tracking-wider text-primary">
                  AI draft from changelog
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Pick a roadmap entry or paste raw notes — the model returns a
                first-pass title, excerpt, body and tags. You always review
                before saving.
              </p>
              <Select
                value={draftRoadmapId || undefined}
                onValueChange={(v) => setDraftRoadmapId(v)}
              >

                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Pick a roadmap entry (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {roadmapOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      [{r.status}] {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="Or paste freeform changelog notes…"
                rows={3}
                className="text-xs"
              />
              <Button
                size="sm"
                onClick={handleAiDraft}
                disabled={drafting || (!draftRoadmapId && !draftNotes.trim())}
                className="w-full gap-1.5"
              >
                {drafting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Drafting…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> Generate draft
                  </>
                )}
              </Button>
            </div>


            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Title
              </label>
              <Input
                value={form.title}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    title: e.target.value,
                    slug: f.slug || generateSlug(e.target.value),
                  }));
                }}
                placeholder="Article title"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Slug
              </label>
              <Input
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="url-friendly-slug"
                className="font-mono text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-mono text-muted-foreground mb-1 block">
                  Category
                </label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground mb-1 block">
                  Status
                </label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Publish at {form.status === "scheduled" && "(required)"}
              </label>
              <Input
                type="datetime-local"
                value={form.publishedAtLocal}
                onChange={(e) =>
                  setForm((f) => ({ ...f, publishedAtLocal: e.target.value }))
                }
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Leave empty to auto-stamp on publish. Set a future time to schedule.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.pinned}
                onCheckedChange={(v) => setForm((f) => ({ ...f, pinned: v }))}
              />
              <label className="text-xs font-mono text-muted-foreground">
                Pinned to top
              </label>
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Tags (comma-separated)
              </label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="ai, infrastructure, models"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Excerpt
              </label>
              <Textarea
                value={form.excerpt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, excerpt: e.target.value }))
                }
                placeholder="Short summary shown in the feed"
                rows={2}
              />
            </div>

            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">
                Body — Markdown (##, ###, **bold**, bullets)
              </label>
              <Tabs defaultValue="write" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-8">
                  <TabsTrigger value="write" className="text-xs">
                    Write
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs">
                    Preview
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="mt-2">
                  <Textarea
                    value={form.body}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, body: e.target.value }))
                    }
                    placeholder="## Heading&#10;&#10;Paragraph with **bold**.&#10;&#10;- bullet"
                    rows={16}
                    className="font-mono text-xs"
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-2">
                  <div className="min-h-[300px] p-4 rounded-md border border-border/50 bg-card/50 text-sm">
                    {form.body.trim() ? (
                      renderNewsMarkdown(form.body)
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Nothing to preview yet.
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Update Article"
                    : "Create Article"}
              </Button>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NewsAiDraftReview
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        draftSessionId={draftSessionId}
        current={{
          title: form.title,
          excerpt: form.excerpt,
          body: form.body,
          category: form.category,
          tags: form.tags,
        }}
        draft={pendingDraft}
        onApply={applyPendingDraft}
      />

      <PublicationClaimsDrawer
        open={gateTarget != null}
        onOpenChange={(open) => !open && setGateTarget(null)}
        surface="news_article"
        recordId={gateTarget?.id ?? null}
        recordLabel={gateTarget?.title}
        onAdmitted={() => {
          setGateTarget(null);
          loadArticles();
        }}
      />
    </div>
  );
}
