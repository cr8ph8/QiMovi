import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  Loader2, Save, FileText, Plus, Trash2, ArrowLeft,
  Sparkles, Check, CloudUpload, BookOpen, ListTree, Send, Radar, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { parseFountain } from "@/lib/fountain-parser";
import { LinkedBriefPanel } from "@/components/writer/LinkedBriefPanel";
import { FountainEditor, FountainEditorHandle } from "@/components/writer/FountainEditor";
import { AiAssistSidebar } from "@/components/writer/AiAssistSidebar";
import { SceneNavigator } from "@/components/writer/SceneNavigator";
import { ProgressStrip } from "@/components/writer/ProgressStrip";
import { useWritingSession } from "@/hooks/useWritingSession";
import { mirrorArtifact } from "@/lib/projectMirror";
import { insertDraftVersion } from "@/lib/screenplay/insertDraftVersion";

const FORMAT_OPTIONS = [
  { value: "vertical", label: "Vertical (1–5 pages)" },
  { value: "micro", label: "Micro Short (1–5 pages)" },
  { value: "short", label: "Short Film (6–19 pages)" },
  { value: "pilot_30", label: "30-Min Pilot" },
  { value: "pilot_60", label: "60-Min Pilot" },
  { value: "feature", label: "Feature" },
];

type DraftRow = {
  id: string;
  title: string;
  format: string | null;
  genre: string | null;
  fountain_text: string;
  brief_id: string | null;
  page_count: number;
  scene_count: number;
  last_edited_at: string;
  target_page_count?: number | null;
  source_entry_id?: string | null;
};

const FOUNTAIN_PLACEHOLDER = `Title: Untitled
Author: You

INT. COFFEE SHOP - MORNING

Steam curls from a forgotten cup. ALEX (30s, restless) stares out the window.

ALEX
(quietly)
Today's the day.

A stranger sits across from them.

STRANGER
Mind if I join?

CUT TO:`;

export default function ScreenplayWriter() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const draftIdParam = params.get("draft");

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("short");
  const [genre, setGenre] = useState("");
  const [fountainText, setFountainText] = useState("");
  const [briefId, setBriefId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string>("");
  const textareaRef = useRef<FountainEditorHandle>(null);
  const [caretOffset, setCaretOffset] = useState(0);
  const [targetPageCount, setTargetPageCount] = useState<number | null>(null);
  const [progressTick, setProgressTick] = useState(0);
  const [sourceEntryId, setSourceEntryId] = useState<string | null>(null);

  useWritingSession({
    userId: user?.id,
    draftId: currentDraftId,
    fountainText,
    format,
    targetPageCount,
    enabled: !!currentDraftId,
    onSessionFlushed: () => setProgressTick((t) => t + 1),
  });

  const jumpToOffset = (offset: number) => {
    const ta = textareaRef.current?.getTextarea();
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(offset, offset);
    // Approximate scroll: use line height * line number
    const before = fountainText.slice(0, offset);
    const lineNum = before.split("\n").length - 1;
    const lineHeight = 24; // matches font leading-6
    ta.scrollTop = Math.max(0, lineNum * lineHeight - ta.clientHeight / 3);
    setCaretOffset(offset);
  };

  const parsed = useMemo(() => parseFountain(fountainText), [fountainText]);

  const fetchDrafts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("screenplay_drafts")
      .select("id, title, format, genre, fountain_text, brief_id, page_count, scene_count, last_edited_at, source_entry_id")
      .order("last_edited_at", { ascending: false })
      .limit(50);
    if (data) setDrafts(data as DraftRow[]);
  };

  useEffect(() => {
    if (!user) return;
    fetchDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Load draft from query param
  useEffect(() => {
    const id = draftIdParam;
    if (!id || !user) return;
    if (id === currentDraftId) return;
    setLoading(true);
    supabase
      .from("screenplay_drafts")
      .select("id, title, format, genre, fountain_text, brief_id, page_count, scene_count, last_edited_at, source_entry_id")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) loadDraft(data as DraftRow);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftIdParam, user?.id]);

  // Autosave
  useEffect(() => {
    if (!currentDraftId || !user) return;
    const snapKey = JSON.stringify({ title, format, genre, fountainText, briefId });
    if (snapKey === lastSnapshotRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      setAutosaveStatus("saving");
      const stats = parseFountain(fountainText).stats;
      const { error } = await supabase
        .from("screenplay_drafts")
        .update({
          title: title || "Untitled Screenplay",
          format,
          genre: genre || null,
          fountain_text: fountainText,
          brief_id: briefId,
          page_count: stats.pageCount,
          scene_count: stats.sceneCount,
          parsed_stats: stats as never,
        })
        .eq("id", currentDraftId);
      if (error) {
        setAutosaveStatus("error");
        return;
      }
      lastSnapshotRef.current = snapKey;
      setAutosaveStatus("saved");
      setLastSavedAt(new Date());
      // Mirror to unified projects/project_artifacts (gated by flag).
      void mirrorArtifact({
        source: "screenplay_drafts",
        sourceId: currentDraftId,
        artifactType: "fountain",
        payload: { title, format, page_count: stats.pageCount, scene_count: stats.sceneCount },
      });
    }, 2500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, format, genre, fountainText, briefId, currentDraftId, user?.id]);

  const loadDraft = (d: DraftRow) => {
    setCurrentDraftId(d.id);
    setTitle(d.title);
    setFormat(d.format || "short");
    setGenre(d.genre || "");
    setFountainText(d.fountain_text || "");
    setBriefId(d.brief_id);
    setTargetPageCount(d.target_page_count ?? null);
    setSourceEntryId(d.source_entry_id ?? null);
    setAutosaveStatus("saved");
    setLastSavedAt(new Date(d.last_edited_at));
    lastSnapshotRef.current = JSON.stringify({
      title: d.title,
      format: d.format || "short",
      genre: d.genre || "",
      fountainText: d.fountain_text || "",
      briefId: d.brief_id,
    });
  };

  const handleNew = () => {
    setCurrentDraftId(null);
    setTitle("");
    setFormat("short");
    setGenre("");
    setFountainText("");
    setBriefId(null);
    setAutosaveStatus("idle");
    setLastSavedAt(null);
    lastSnapshotRef.current = "";
    setParams({});
  };

  const handleSave = async () => {
    if (!user) return;
    const stats = parsed.stats;
    const payload = {
      user_id: user.id,
      title: title || "Untitled Screenplay",
      format,
      genre: genre || null,
      fountain_text: fountainText,
      brief_id: briefId,
      page_count: stats.pageCount,
      scene_count: stats.sceneCount,
      parsed_stats: stats as never,
    };

    if (currentDraftId) {
      const { error } = await supabase
        .from("screenplay_drafts")
        .update(payload)
        .eq("id", currentDraftId);
      if (error) return toast.error(error.message);
      await insertDraftVersion({
        draftId: currentDraftId,
        userId: user.id,
        fountainText,
        title: payload.title,
        pageCount: stats.pageCount,
        triggerAction: "manual_edit",
        triggerMetadata: { origin: "ScreenplayWriter.handleSave" },
      });
      toast.success("Saved.");
    } else {
      const { data, error } = await supabase
        .from("screenplay_drafts")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) return toast.error(error?.message || "Save failed");
      setCurrentDraftId(data.id);
      setParams({ draft: data.id });
      await insertDraftVersion({
        draftId: data.id,
        userId: user.id,
        fountainText,
        title: payload.title,
        pageCount: stats.pageCount,
        triggerAction: "manual_edit",
        triggerMetadata: { origin: "ScreenplayWriter.handleSave", firstSnapshot: true },
      });
      toast.success("Draft saved.");
    }
    setLastSavedAt(new Date());
    setAutosaveStatus("saved");
    fetchDrafts();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    const { error } = await supabase.from("screenplay_drafts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (id === currentDraftId) handleNew();
    fetchDrafts();
    toast.success("Draft deleted.");
  };

  const insertAtCursor = (text: string) => {
    textareaRef.current?.insertAtCursor(text);
  };

  const getAssistContext = () => {
    const ta = textareaRef.current?.getTextarea();
    if (!ta) return { selection: "", sceneContext: "" };
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selection = start !== end ? fountainText.slice(start, end) : "";

    // Scene context = current scene block (from prior scene heading to next, or +/- 1200 chars)
    const SCENE_RE = /^(INT\.|EXT\.|EST\.|INT\/EXT\.|I\/E\.)/im;
    const before = fountainText.slice(0, start);
    const after = fountainText.slice(end);
    // Find previous scene heading
    const lines = before.split("\n");
    let sceneStartLine = lines.length - 1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (SCENE_RE.test(lines[i].trim())) { sceneStartLine = i; break; }
      if (lines.length - i > 80) break;
    }
    const sceneStart = lines.slice(0, sceneStartLine).join("\n").length + (sceneStartLine > 0 ? 1 : 0);
    // Find next scene heading after caret
    const afterLines = after.split("\n");
    let nextOffset = after.length;
    let acc = 0;
    for (let i = 1; i < afterLines.length; i++) {
      acc += afterLines[i - 1].length + 1;
      if (SCENE_RE.test(afterLines[i].trim())) { nextOffset = acc; break; }
    }
    const sceneContext = fountainText.slice(sceneStart, end + nextOffset).slice(0, 4000);
    return { selection, sceneContext };
  };

  const handleSubmit = async () => {
    if (!currentDraftId) {
      toast.error("Save the draft first.");
      return;
    }
    await handleSave();
    navigate(`/submit?draft=${currentDraftId}`);
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="container py-20 flex justify-center">
          <Loader2 className="animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="container py-20 text-center space-y-4">
          <h1 className="font-display text-3xl">Screenplay Writer</h1>
          <p className="text-muted-foreground">Sign in to start writing.</p>
          <Button asChild><Link to="/auth">Sign in</Link></Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-8 max-w-[1400px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl tracking-tight">
              Screenplay <span className="text-gradient-gold">Writer</span>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm max-w-xl">
              Write in Fountain syntax — scenes, characters, and dialogue formatted live on the right.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/brain-dump"><ArrowLeft className="h-4 w-4" /> Brain Dump</Link>
            </Button>
            <Button variant="outline" size="sm" asChild title="Run SignalCheck on this draft" disabled={!currentDraftId}>
              <Link to={`/signalcheck/analyze${currentDraftId ? `?draft=${currentDraftId}` : ""}`}>
                <Radar className="h-4 w-4" /> SignalCheck
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild title="Certify authorship with Shield" disabled={!currentDraftId}>
              <Link to={`/shield/analyze${currentDraftId ? `?draft=${currentDraftId}` : ""}`}>
                <ShieldCheck className="h-4 w-4" /> Shield
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleNew}>
              <Plus className="h-4 w-4" /> New
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading}>
              <Save className="h-4 w-4" /> Save
            </Button>
            <Button size="sm" variant="default" onClick={handleSubmit} disabled={!currentDraftId}>
              <Send className="h-4 w-4" /> Submit
            </Button>
          </div>
        </header>

        {/* Metadata row */}
        <Card className="mb-4">
          <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
            <Input
              placeholder="Screenplay title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Genre (optional)"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            />
            <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
              {sourceEntryId && (
                <Link
                  to={`/entry/${sourceEntryId}#insights`}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-primary hover:bg-primary/20"
                  title="View the original submission this draft was forked from"
                >
                  ↪ Forked from submission
                </Link>
              )}
              <Badge variant="secondary">{parsed.stats.pageCount} pp</Badge>
              <Badge variant="secondary">{parsed.stats.sceneCount} scenes</Badge>
              <Badge variant="secondary">{parsed.stats.uniqueCharacters.length} chars</Badge>
              {autosaveStatus === "saving" && (
                <span className="inline-flex items-center gap-1"><CloudUpload className="h-3 w-3 animate-pulse" /> Saving…</span>
              )}
              {autosaveStatus === "saved" && lastSavedAt && (
                <span className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-emerald-400" /> {lastSavedAt.toLocaleTimeString()}</span>
              )}
              {autosaveStatus === "error" && (
                <span className="text-destructive">Save failed</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Progress strip — words today, completion %, session timer, streak */}
        <Card className="mb-4">
          <CardContent className="py-3">
            <ProgressStrip
              userId={user?.id}
              draftId={currentDraftId}
              fountainText={fountainText}
              format={format}
              targetPageCount={targetPageCount}
              onTargetChange={setTargetPageCount}
              pageCount={parsed.stats.pageCount}
              refreshKey={progressTick}
            />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-4">
          {/* Editor */}
          <Card className="flex flex-col">
            <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <FileText className="h-4 w-4" /> Editor
              </CardTitle>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => insertAtCursor("INT. LOCATION - DAY")}>Scene</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => insertAtCursor("CHARACTER\nDialogue here.")}>Dialogue</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => insertAtCursor("Action description.")}>Action</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => insertAtCursor("CUT TO:")}>Transition</Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 flex-1">
              <FountainEditor
                ref={textareaRef}
                value={fountainText}
                onChange={setFountainText}
                placeholder={FOUNTAIN_PLACEHOLDER}
                minHeight={600}
              />

            </CardContent>
          </Card>

          {/* Preview */}
          <Card className="flex flex-col">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Live Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="h-[640px] rounded-md border border-border/40 bg-background/40 p-6">
                <FountainPreview elements={parsed.elements} />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Right rail */}
          <div className="space-y-4">
            <SceneNavigator
              fountainText={fountainText}
              parsed={parsed}
              onJump={jumpToOffset}
              activeOffset={caretOffset}
              baselineKey={`${currentDraftId ?? "new"}:${lastSavedAt?.getTime() ?? 0}`}
            />


            <AiAssistSidebar
              draftId={currentDraftId}
              fullScript={fountainText}
              getContext={getAssistContext}
              onInsert={insertAtCursor}
            />

            <LinkedBriefPanel
              briefId={briefId}
              onLink={setBriefId}
              onInsertScaffold={(text) => insertAtCursor(text)}
              userId={user.id}
            />

            <Card>
              <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-display">Your Drafts</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {drafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No drafts yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {drafts.map((d) => (
                      <li key={d.id} className={`flex items-center justify-between rounded-md border px-2 py-1.5 ${
                        d.id === currentDraftId ? "border-primary/60 bg-primary/5" : "border-border/40"
                      }`}>
                        <button
                          className="flex-1 text-left text-xs hover:text-primary truncate"
                          onClick={() => {
                            setParams({ draft: d.id });
                            loadDraft(d);
                          }}
                        >
                          <div className="font-semibold truncate">{d.title}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {d.page_count}pp · {d.scene_count} scenes
                          </div>
                        </button>
                        <Button variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => handleDelete(d.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ── Lightweight Fountain preview (renders without analysis chrome) ── */
function FountainPreview({ elements }: { elements: ReturnType<typeof parseFountain>["elements"] }) {
  if (elements.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-20 text-sm">
        <Sparkles className="mx-auto mb-2 text-primary h-5 w-5" />
        Your formatted screenplay appears here as you type.
      </div>
    );
  }
  return (
    <div className="font-mono text-[13px] leading-[1.4] text-foreground/90 max-w-[680px] mx-auto">
      {elements.map((el, i) => {
        switch (el.type) {
          case "scene_heading":
            return <p key={i} className="font-bold uppercase text-primary mt-5 mb-1">{el.text}</p>;
          case "character":
            return <p key={i} className="font-semibold uppercase text-center mt-3 mb-0.5 tracking-wider">{el.text}</p>;
          case "parenthetical":
            return <p key={i} className="italic text-muted-foreground text-center">{el.text}</p>;
          case "dialogue":
            return <p key={i} className="text-center mx-auto max-w-[60%]">{el.text}</p>;
          case "transition":
            return <p key={i} className="uppercase text-right text-muted-foreground mt-3 mb-1">{el.text}</p>;
          case "action":
            return <p key={i} className="my-1.5">{el.text}</p>;
          case "page_break":
            return <hr key={i} className="my-4 border-border/40" />;
          case "empty":
            return <div key={i} className="h-2" />;
          default:
            return <p key={i}>{el.text}</p>;
        }
      })}
    </div>
  );
}
