import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles, Save, Trash2, FileText, Plus, Check, CloudUpload, Search, X, Square } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { OrganizedBriefCard, type OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";
import { PromoteBriefDialog } from "@/components/braindump/PromoteBriefDialog";
import { PromoteTimelinePanel } from "@/components/braindump/PromoteTimelinePanel";
import { usePromoteBrief } from "@/hooks/usePromoteBrief";
import { SceneOutlinePanel, type Outline } from "@/components/braindump/SceneOutlinePanel";
import { ShareBriefDialog } from "@/components/braindump/ShareBriefDialog";
import { BriefComments } from "@/components/braindump/BriefComments";
import { BriefCommentAuditLog } from "@/components/braindump/BriefCommentAuditLog";
import { AttachScreenplayPicker } from "@/components/braindump/AttachScreenplayPicker";
import { BriefVersionHistory, type BriefVersion } from "@/components/braindump/BriefVersionHistory";
import { BeatSceneMapPanel } from "@/components/braindump/BeatSceneMapPanel";
// FeatureTierGate removed: BrainDumpProGate handles plan gating; edge function enforces Pro server-side.
import { BrainDumpProGate } from "@/components/braindump/BrainDumpProGate";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { ScreenplayBriefThread } from "@/components/braindump/ScreenplayBriefThread";
import { BrainDumpUploader } from "@/components/braindump/BrainDumpUploader";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

const FORMAT_OPTIONS = [
  { value: "auto", label: "Let AI suggest" },
  { value: "vertical", label: "Vertical" },
  { value: "micro", label: "Micro Short" },
  { value: "short", label: "Short Film" },
  { value: "pilot_30", label: "30-Min Pilot" },
  { value: "pilot_60", label: "60-Min Pilot" },
  { value: "feature", label: "Feature" },
];

const NO_ENTRY = "__none__";
const ALL_ENTRIES = "__all__";

type EntryRow = { id: string; title: string };

type SavedBrief = {
  id: string;
  title: string | null;
  raw_dump: string | null;
  organized: OrganizedBrief;
  outline: Outline | null;
  confidence: number | null;
  created_at: string;
  visibility: "private" | "unlisted" | "public";
  share_token: string | null;
  share_expires_at: string | null;
  share_password_hash: string | null;
  entry_id: string | null;
  entries?: { id: string; title: string } | null;
};

export default function BrainDump() {
  const { user, loading: authLoading } = useAuth();
  const { canAccessFeature, loading: subLoading } = useSubscription();
  const isPro = canAccessFeature("pro");
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("auto");
  const [genre, setGenre] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const [organizeStage, setOrganizeStage] = useState<"idle" | "preparing" | "sending" | "thinking" | "revealing" | "saving" | "done" | "canceled" | "failed">("idle");
  const [lastFailedStage, setLastFailedStage] = useState<"preparing" | "sending" | "thinking" | "revealing" | "saving" | null>(null);
  const [lastErrorMsg, setLastErrorMsg] = useState<string | null>(null);
  const organizeAbortRef = useRef<AbortController | null>(null);
  const [streamPartials, setStreamPartials] = useState<Array<{ key: string; label: string; value: unknown }>>([]);
  const [organizeElapsed, setOrganizeElapsed] = useState(0);
  const [organized, setOrganized] = useState<OrganizedBrief | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SavedBrief[]>([]);
  const [currentBriefId, setCurrentBriefId] = useState<string | null>(null);
  const [currentOutline, setCurrentOutline] = useState<Outline | null>(null);
  const [highlightedBeat, setHighlightedBeat] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string>(NO_ENTRY);
  const [filterEntryId, setFilterEntryId] = useState<string>(ALL_ENTRIES);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const promoteController = usePromoteBrief();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFormat, setFilterFormat] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "title" | "confidence">("recent");
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string>("");
  // Tracks whether the component is still mounted so late async callbacks
  // (stream events, abort timeouts, post-cancel resolves) cannot call
  // setState after unmount.
  const isMountedRef = useRef(true);
  // Marks the current in-flight organize run as user-canceled so any late
  // resolution from the network/stream cannot flip the panel back into a
  // working state after the Cancel button was pressed.
  const organizeCanceledRef = useRef(false);
  // Timer that returns the panel to the idle state after a terminal stage
  // (canceled/done). Tracked so we can clear it on unmount or on the next run.
  const idleResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (idleResetTimerRef.current) {
        clearTimeout(idleResetTimerRef.current);
        idleResetTimerRef.current = null;
      }
      // Abort any in-flight organize request so its callbacks short-circuit.
      if (organizeAbortRef.current) {
        try { organizeAbortRef.current.abort(); } catch { /* ignore */ }
        organizeAbortRef.current = null;
      }
    };
  }, []);

  const scheduleIdleReset = (fromStage: "canceled" | "done", delayMs: number) => {
    if (idleResetTimerRef.current) clearTimeout(idleResetTimerRef.current);
    idleResetTimerRef.current = setTimeout(() => {
      idleResetTimerRef.current = null;
      if (!isMountedRef.current) return;
      setOrganizeStage((s) => {
        if (s !== fromStage) return s;
        // Returning to idle: clear the anchor + job id so the next run starts
        // a fresh elapsed window and mints a new server-side job.
        organizeStartedAtRef.current = null;
        setOrganizeStartedAt(null);
        setOrganizeElapsed(0);
        organizeJobIdRef.current = null;
        setOrganizeJobId(null);
        return "idle";
      });
    }, delayMs);
  };

  const DRAFT_KEY = "braindump:draft";

  // Load any unsaved draft on mount (only if not editing an existing brief).
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { title?: string; rawText?: string; selectedEntryId?: string };
      if (d?.rawText && !rawText && !currentBriefId) {
        setRawText(d.rawText);
        if (d.title) setTitle(d.title);
        if (d.selectedEntryId) setSelectedEntryId(d.selectedEntryId);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Persist unsaved drafts locally so users can resume from the portfolio panel.
  useEffect(() => {
    if (currentBriefId) return; // saved briefs autosave to DB instead
    try {
      if (rawText.trim().length === 0 && !title) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ title, rawText, selectedEntryId, savedAt: new Date().toISOString() }),
        );
      }
    } catch { /* ignore quota */ }
  }, [title, rawText, selectedEntryId, currentBriefId]);

  // Clear local draft once a brief has been persisted.
  useEffect(() => {
    if (currentBriefId) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    }
  }, [currentBriefId]);

  const fetchEntries = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("entries")
      .select("id, title")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    setEntries((data ?? []) as EntryRow[]);
  };

  const fetchHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("project_briefs")
      .select("id,title,raw_dump,organized,outline,confidence,created_at,visibility,share_token,share_expires_at,share_password_hash,entry_id,entries(id,title)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setHistory(data as unknown as SavedBrief[]);
  };

  useEffect(() => {
    fetchHistory();
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Snapshot a version row for the current brief.
  const snapshotVersion = async (
    briefId: string,
    source: "manual" | "autosave" | "ai_organize",
    over?: { title?: string; rawText?: string; organized?: OrganizedBrief | null },
  ): Promise<string | null> => {
    if (!user) return null;
    const snap = {
      brief_id: briefId,
      user_id: user.id,
      title: over?.title ?? title ?? null,
      raw_dump: over?.rawText ?? rawText,
      organized: (over?.organized ?? organized ?? {}) as never,
      format_suggestion: (over?.organized ?? organized)?.suggested_format ?? null,
      confidence: (over?.organized ?? organized)?.confidence ?? null,
      source,
    };
    const { data, error } = await supabase
      .from("project_brief_versions")
      .insert(snap)
      .select("id")
      .single();
    if (error) {
      if (source === "manual") toast.error("Version snapshot failed.");
      return null;
    }
    if (data?.id) setLatestVersionId(data.id);
    return data?.id ?? null;
  };

  // Autosave: when a brief is loaded, persist edits 2.5s after last change.
  useEffect(() => {
    if (!currentBriefId || !user) return;
    const snapshotKey = JSON.stringify({ title, rawText, organized, selectedEntryId });
    if (snapshotKey === lastSnapshotRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      setAutosaveStatus("saving");
      const payload = {
        title: title || organized?.logline?.slice(0, 80) || "Untitled brief",
        raw_dump: rawText,
        organized: (organized ?? {}) as never,
        format_suggestion: organized?.suggested_format ?? null,
        confidence: organized?.confidence ?? null,
        entry_id: selectedEntryId !== NO_ENTRY ? selectedEntryId : null,
      };
      const { error } = await supabase
        .from("project_briefs")
        .update(payload)
        .eq("id", currentBriefId);
      if (error) {
        setAutosaveStatus("error");
        return;
      }
      await snapshotVersion(currentBriefId, "autosave");
      lastSnapshotRef.current = snapshotKey;
      setAutosaveStatus("saved");
      setLastSavedAt(new Date());
    }, 2500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, rawText, organized, selectedEntryId, currentBriefId, user?.id]);

  // ---------- Persist Organize job status across reloads ----------
  const JOB_KEY = "braindump:organize-job";
  // Wall-clock start of the current organize run (epoch ms). Persisted so the
  // elapsed counter can be recomputed accurately after a tab reload instead of
  // resuming from a snapshotted seconds value that grew stale while away.
  const organizeStartedAtRef = useRef<number | null>(null);
  const [organizeStartedAt, setOrganizeStartedAt] = useState<number | null>(null);
  // Client-minted UUID that addresses the server-side organize_jobs row. The
  // same id is reused on Retry/Resume so token spend is idempotent and the
  // server can replay a finished result instead of re-running the model.
  const organizeJobIdRef = useRef<string | null>(null);
  const [organizeJobId, setOrganizeJobId] = useState<string | null>(null);
  const mintJobId = () => {
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    organizeJobIdRef.current = id;
    setOrganizeJobId(id);
    return id;
  };

  // Restore last known job status on mount. If a job was in-flight when the
  // page was reloaded, surface it as a failed/interrupted state so the Retry
  // button can re-run the same server-side job_id.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        stage: typeof organizeStage;
        lastFailedStage: typeof lastFailedStage;
        lastErrorMsg: string | null;
        elapsed: number;
        startedAt?: number | null;
        streamPartials: typeof streamPartials;
        jobId?: string | null;
      };
      const inflight = ["preparing", "sending", "thinking", "revealing", "saving"].includes(s.stage);
      if (inflight) {
        setOrganizeStage("failed");
        setLastFailedStage(s.stage as typeof lastFailedStage);
        setLastErrorMsg("Interrupted — page reloaded before the job finished. Retry to resume the same job.");
      } else {
        setOrganizeStage(s.stage);
        setLastFailedStage(s.lastFailedStage);
        setLastErrorMsg(s.lastErrorMsg);
      }
      if (s.jobId) {
        organizeJobIdRef.current = s.jobId;
        setOrganizeJobId(s.jobId);
      }
      // Prefer recomputing elapsed from the persisted wall-clock start so the
      // counter stays accurate across reloads instead of drifting backwards to
      // whatever seconds value was last snapshotted to storage.
      if (typeof s.startedAt === "number" && Number.isFinite(s.startedAt)) {
        organizeStartedAtRef.current = s.startedAt;
        setOrganizeStartedAt(s.startedAt);
        const live = Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000));
        setOrganizeElapsed(inflight ? live : Math.max(live, s.elapsed || 0));
      } else {
        setOrganizeElapsed(s.elapsed || 0);
      }
      setStreamPartials(s.streamPartials || []);
    } catch {
      /* ignore corrupted job state */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist Organize job state whenever it changes. Clear when idle.
  useEffect(() => {
    try {
      if (organizeStage === "idle") {
        localStorage.removeItem(JOB_KEY);
        return;
      }
      localStorage.setItem(
        JOB_KEY,
        JSON.stringify({
          stage: organizeStage,
          lastFailedStage,
          lastErrorMsg,
          elapsed: organizeElapsed,
          startedAt: organizeStartedAt,
          streamPartials,
          jobId: organizeJobId,
        }),
      );
    } catch {
      /* ignore quota errors */
    }
  }, [organizeStage, lastFailedStage, lastErrorMsg, organizeElapsed, organizeStartedAt, streamPartials, organizeJobId]);

  // Elapsed timer + stage auto-advance while organizing.
  const elapsedTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!organizing) {
      if (elapsedTickRef.current) {
        clearInterval(elapsedTickRef.current);
        elapsedTickRef.current = null;
      }
      return;
    }
    // Anchor the elapsed counter to a wall-clock start time so re-mounts and
    // tab reloads can recompute elapsed from the same source of truth instead
    // of resetting to zero. handleOrganize seeds organizeStartedAtRef before
    // flipping `organizing` true; fall back to "now" only if it's missing.
    const startedAt = organizeStartedAtRef.current ?? Date.now();
    if (organizeStartedAtRef.current !== startedAt) {
      organizeStartedAtRef.current = startedAt;
      setOrganizeStartedAt(startedAt);
    }
    setOrganizeElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const tick = setInterval(() => {
      // Stop pushing progress updates the moment cancel/unmount has fired,
      // even before the effect cleanup gets a chance to run.
      if (organizeCanceledRef.current || !isMountedRef.current) {
        clearInterval(tick);
        if (elapsedTickRef.current === tick) elapsedTickRef.current = null;
        return;
      }
      const anchor = organizeStartedAtRef.current ?? startedAt;
      const secs = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
      setOrganizeElapsed(secs);
      // Auto-advance "thinking" stage hints if the call is slow.
      setOrganizeStage((prev) => {
        const terminal: typeof organizeStage[] = ["done", "canceled", "failed"];
        if (terminal.includes(prev)) return prev;
        if (prev === "sending" && secs >= 2) return "thinking";
        return prev;
      });
    }, 250);
    elapsedTickRef.current = tick;
    return () => {
      clearInterval(tick);
      if (elapsedTickRef.current === tick) elapsedTickRef.current = null;
    };
  }, [organizing]);

  const handleCancelOrganize = () => {
    const terminal: typeof organizeStage[] = ["done", "canceled", "failed"];
    if (!organizing || terminal.includes(organizeStage) || !organizeAbortRef.current) return;
    organizeCanceledRef.current = true;
    organizeAbortRef.current.abort();
    organizeAbortRef.current = null;
    // Stop the elapsed-time polling interval immediately so no further
    // progress ticks land after the user clicked Cancel.
    if (elapsedTickRef.current) {
      clearInterval(elapsedTickRef.current);
      elapsedTickRef.current = null;
    }
    // Cancel any pending idle reset scheduled by a prior terminal stage so
    // it can't snap the panel state out from under the canceled label.
    if (idleResetTimerRef.current) {
      clearTimeout(idleResetTimerRef.current);
      idleResetTimerRef.current = null;
    }
    setOrganizing(false);
    setOrganizeStage("canceled");
    setLastErrorMsg(null);
    setLastFailedStage(null);
    // Fire-and-forget: mark the server-side row canceled so a later resume
    // sees the correct status instead of an orphaned "streaming" job.
    const jobId = organizeJobIdRef.current;
    if (jobId) {
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const accessToken = session?.access_token;
          if (!accessToken) return;
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/organize-brain-dump`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({ action: "cancel", job_id: jobId }),
            },
          ).catch(() => { /* ignore */ });
        } catch { /* ignore */ }
      })();
    }
    toast.info("Organize canceled", {
      description: "No results were generated and your brain dump was not changed.",
    });
    scheduleIdleReset("canceled", 2000);
  };

  const handleOrganize = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (rawText.trim().length < 20) {
      toast.error("Add at least a few sentences before organizing.");
      return;
    }
    // Clear any pending idle-reset from a previous run so it cannot fire
    // mid-way through this one and snap the panel back to idle.
    if (idleResetTimerRef.current) {
      clearTimeout(idleResetTimerRef.current);
      idleResetTimerRef.current = null;
    }
    organizeCanceledRef.current = false;
    const controller = new AbortController();
    organizeAbortRef.current = controller;
    // Anchor the elapsed counter to a wall-clock start so the timer effect
    // (and any post-reload restore) all derive seconds from the same instant.
    const startedAtMs = Date.now();
    organizeStartedAtRef.current = startedAtMs;
    setOrganizeStartedAt(startedAtMs);
    setOrganizeElapsed(0);
    setOrganizing(true);
    setOrganizeStage("preparing");
    setLastFailedStage(null);
    setLastErrorMsg(null);
    setOrganized(null);
    setStreamPartials([]);

    // Reuse the persisted job_id if one exists (Retry / Resume path). When
    // there's no existing id, mint a fresh UUID and persist it before the
    // network call so reloads and cancels can address the same server row.
    const existingJobId = organizeJobIdRef.current;
    const isResume = !!existingJobId;
    const jobIdForRun = existingJobId ?? mintJobId();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sign in to organize.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/organize-brain-dump`;
      setOrganizeStage("sending");
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${accessToken}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          job_id: jobIdForRun,
          resume: isResume,
          raw_text: rawText,
          entry_id: selectedEntryId !== NO_ENTRY ? selectedEntryId : undefined,
          hints: {
            title: title || undefined,
            format: format !== "auto" ? format : undefined,
            genre: genre || undefined,
          },
        }),
        signal: controller.signal,
      });

      // The server returns 409 with { code: "in_progress" } when the same
      // job is still running on its side. Surface that as a soft message and
      // keep the persisted state — the user can hit Retry again shortly.
      if (resp.status === 409) {
        const j = await resp.json().catch(() => ({}));
        const stage = (j?.stage as string) || "thinking";
        toast.info("Still running on the server", {
          description: `Current stage: ${stage}. Try again in a moment to reconnect.`,
        });
        setOrganizing(false);
        setOrganizeStage("failed");
        setLastFailedStage(stage as typeof lastFailedStage);
        setLastErrorMsg("Job is still running on the server.");
        return;
      }

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "");
        let msg = `Organize failed (${resp.status})`;
        try { const j = JSON.parse(txt); msg = j.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalOrganized: OrganizedBrief | null = null;
      let streamError: string | null = null;
      const partialsAcc: Array<{ key: string; label: string; value: unknown }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!raw.trim()) continue;
          let event = "message";
          let dataStr = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataStr); } catch { continue; }

          // Drop any progress events that arrive after the user canceled
          // (or the component unmounted) — the panel is already terminal.
          if (organizeCanceledRef.current || controller.signal.aborted || !isMountedRef.current) {
            continue;
          }

          if (event === "stage") {
            const s = String(payload.stage ?? "");
            setOrganizeStage((prev) => {
              const terminal: typeof organizeStage[] = ["done", "canceled", "failed"];
              if (terminal.includes(prev)) return prev;
              if (["preparing", "sending", "thinking", "revealing", "saving"].includes(s)) {
                return s as typeof organizeStage;
              }
              return prev;
            });
          } else if (event === "heartbeat") {
            // server-driven elapsed; the local timer already updates UI
          } else if (event === "partial") {
            partialsAcc.push({
              key: String(payload.key),
              label: String(payload.label ?? payload.key),
              value: payload.value,
            });
            setStreamPartials([...partialsAcc]);
          } else if (event === "done") {
            finalOrganized = payload.organized as OrganizedBrief;
          } else if (event === "error") {
            streamError = String(payload.error ?? "Organize failed.");
          }
        }
      }

      if (streamError) throw new Error(streamError);
      // Bail out if the user canceled, the controller aborted, or the
      // component unmounted while the stream was draining.
      if (controller.signal.aborted || organizeCanceledRef.current || !isMountedRef.current) return;
      if (!finalOrganized) throw new Error("Stream ended without a result.");

      const next = finalOrganized;
      setOrganized(next);
      setOrganizeStage("saving");

      // Auto-persist so the organize result survives reloads, even if the
      // user never clicks "Save". Create a brief row if one doesn't exist;
      // otherwise update the existing row in place.
      let briefIdForSnapshot = currentBriefId;
      if (user) {
        const payload = {
          user_id: user.id,
          title: title || next.logline?.slice(0, 80) || "Untitled brief",
          raw_dump: rawText,
          organized: next as never,
          format_suggestion: next.suggested_format ?? null,
          confidence: next.confidence ?? null,
          entry_id: selectedEntryId !== NO_ENTRY ? selectedEntryId : null,
        };
        if (currentBriefId) {
          await supabase.from("project_briefs").update(payload).eq("id", currentBriefId);
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("project_briefs")
            .insert(payload)
            .select("id")
            .single();
          if (!insertErr && inserted?.id) {
            setCurrentBriefId(inserted.id);
            briefIdForSnapshot = inserted.id;
          }
        }
      }

      if (briefIdForSnapshot) {
        await snapshotVersion(briefIdForSnapshot, "ai_organize", { organized: next });
      }
      if (organizeCanceledRef.current || !isMountedRef.current) return;
      setOrganizeStage("done");
      toast.success("Brain dump organized & saved.");
    } catch (e) {
      const isAbort = controller.signal.aborted || (e instanceof Error && e.name === "AbortError");
      if (!isMountedRef.current) return;
      if (isAbort) {
        // handleCancelOrganize already set stage="canceled", scheduled the
        // idle reset, and showed the toast; don't duplicate here.
        if (!organizeCanceledRef.current) {
          setOrganizeStage("canceled");
          setLastErrorMsg(null);
          setLastFailedStage(null);
          toast.info("Organize canceled", {
            description: "No results were generated and your brain dump was not changed.",
          });
          scheduleIdleReset("canceled", 2000);
        }
        return;
      }
      const msg = e instanceof Error ? e.message : "Failed to organize.";
      toast.error(msg);
      // Capture the last in-flight stage so we can show & retry from it.
      setOrganizeStage((prev) => {
        if (prev !== "idle" && prev !== "done" && prev !== "canceled" && prev !== "failed") {
          setLastFailedStage(prev as typeof lastFailedStage);
        }
        return "failed";
      });
      setLastErrorMsg(msg);
    } finally {
      if (organizeAbortRef.current === controller) organizeAbortRef.current = null;
      if (isMountedRef.current && !controller.signal.aborted && !organizeCanceledRef.current) {
        setOrganizing(false);
        // Let "done" linger briefly so the user sees completion before we
        // return to the idle state.
        scheduleIdleReset("done", 1500);
      }
    }
  };

  const handleSave = async () => {
    if (!organized || !user) return;
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        title: title || organized.logline?.slice(0, 80) || "Untitled brief",
        raw_dump: rawText,
        organized: organized as never,
        format_suggestion: organized.suggested_format ?? null,
        confidence: organized.confidence ?? null,
        entry_id: selectedEntryId !== NO_ENTRY ? selectedEntryId : null,
      };

      let savedId = currentBriefId;
      if (currentBriefId) {
        const { error } = await supabase
          .from("project_briefs")
          .update(payload)
          .eq("id", currentBriefId);
        if (error) throw error;
        toast.success("Brief updated.");
      } else {
        const { data, error } = await supabase
          .from("project_briefs")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        if (data?.id) {
          setCurrentBriefId(data.id);
          savedId = data.id;
        }
        toast.success("Saved as project brief.");
      }
      const newVersionId = savedId ? await snapshotVersion(savedId, "manual") : null;
      // If this brief is linked to a screenplay draft, post an "update" message
      // tying the snapshot to that draft.
      if (savedId && newVersionId && selectedEntryId !== NO_ENTRY) {
        const briefSummary =
          (organized?.logline ?? "").trim() ||
          (title ?? "").trim() ||
          "Brief updated.";
        await supabase.rpc("post_entry_brief_message", {
          p_entry_id: selectedEntryId,
          p_body: `Brain dump update: ${briefSummary}`.slice(0, 4000),
          p_brief_id: savedId,
          p_brief_version_id: newVersionId,
          p_kind: "update",
          p_source: "manual",
        });
      }
      lastSnapshotRef.current = JSON.stringify({ title, rawText, organized, selectedEntryId });
      setLastSavedAt(new Date());
      setAutosaveStatus("saved");
      fetchHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("project_briefs").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed.");
      return;
    }
    if (id === currentBriefId) handleNewBrief();
    toast.success("Brief deleted.");
    fetchHistory();
  };

  const loadBrief = (b: SavedBrief) => {
    setOrganized(b.organized);
    setTitle(b.title ?? "");
    setRawText(b.raw_dump ?? "");
    setSelectedEntryId(b.entry_id ?? NO_ENTRY);
    setCurrentBriefId(b.id);
    setCurrentOutline(b.outline ?? null);
    lastSnapshotRef.current = JSON.stringify({
      title: b.title ?? "",
      rawText: b.raw_dump ?? "",
      organized: b.organized,
      selectedEntryId: b.entry_id ?? NO_ENTRY,
    });
    setAutosaveStatus("saved");
    setLastSavedAt(new Date(b.created_at));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNewBrief = () => {
    setOrganized(null);
    setRawText("");
    setTitle("");
    setGenre("");
    setFormat("auto");
    setCurrentBriefId(null);
    setCurrentOutline(null);
    setSelectedEntryId(NO_ENTRY);
    lastSnapshotRef.current = "";
    setAutosaveStatus("idle");
    setLastSavedAt(null);
  };

  const restoreVersion = (v: BriefVersion) => {
    setTitle(v.title ?? "");
    setRawText(v.raw_dump ?? "");
    setOrganized(v.organized);
    setAutosaveStatus("idle");
  };

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = history;
    if (filterEntryId === NO_ENTRY) list = list.filter((b) => !b.entry_id);
    else if (filterEntryId !== ALL_ENTRIES) list = list.filter((b) => b.entry_id === filterEntryId);
    if (filterFormat !== "all") {
      list = list.filter((b) => (b.organized?.suggested_format ?? "") === filterFormat);
    }
    if (q) {
      list = list.filter((b) => {
        const o = b.organized ?? ({} as OrganizedBrief);
        const hay = [
          b.title ?? "",
          b.raw_dump ?? "",
          o.logline ?? "",
          o.premise ?? "",
          o.reasoning ?? "",
          (o.themes ?? []).join(" "),
          (o.open_questions ?? []).join(" "),
          (o.characters ?? []).map((c) => `${c.name} ${c.role ?? ""} ${c.description ?? ""} ${c.want ?? ""} ${c.need ?? ""}`).join(" "),
          (o.plot_beats ?? []).map((p) => `${p.beat_name} ${p.description}`).join(" "),
          (o.scene_fragments ?? []).map((s) => s.verbatim).join(" "),
          b.entries?.title ?? "",
        ]
          .join(" \n ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return +new Date(a.created_at) - +new Date(b.created_at);
        case "title":
          return (a.title ?? "").localeCompare(b.title ?? "");
        case "confidence":
          return (b.confidence ?? 0) - (a.confidence ?? 0);
        case "recent":
        default:
          return +new Date(b.created_at) - +new Date(a.created_at);
      }
    });
    return sorted;
  }, [history, filterEntryId, searchQuery, filterFormat, sortBy]);

  const availableFormats = useMemo(() => {
    const set = new Set<string>();
    history.forEach((b) => {
      const f = b.organized?.suggested_format;
      if (f) set.add(f);
    });
    return Array.from(set);
  }, [history]);

  const selectedEntryTitle = useMemo(() => {
    if (selectedEntryId === NO_ENTRY) return null;
    return entries.find((e) => e.id === selectedEntryId)?.title ?? null;
  }, [entries, selectedEntryId]);

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
          <h1 className="font-display text-3xl">Brain Dump</h1>
          <p className="text-muted-foreground">Sign in to organize your ideas.</p>
          <Button asChild><Link to="/auth">Sign in</Link></Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-10 max-w-7xl">
        <header className="mb-8">
          <h1 className="font-display text-4xl tracking-tight">
            Brain <span className="text-gradient-gold">Dump</span>
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Pour every fragment, half-thought, image, line of dialogue, and stray idea into the box
            below. AI will filter the noise and organize it into a structured project brief.
          </p>
        </header>

        {!subLoading && !isPro ? (
          <BrainDumpProGate />
        ) : (
        <>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: input */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="font-display">
                  {currentBriefId ? "Editing Brief" : "Your Dump"}
                </CardTitle>
                {currentBriefId && (
                  <Button variant="ghost" size="sm" onClick={handleNewBrief}>
                    <Plus className="h-4 w-4" /> New brief
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    placeholder="Working title (optional)"
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
                </div>

                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={selectedEntryId} onValueChange={setSelectedEntryId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Attach to a competition entry…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ENTRY}>No entry — standalone brief</SelectItem>
                      {entries.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedEntryTitle && (
                  <p className="text-xs text-muted-foreground">
                    Brief will be saved against <span className="text-primary">{selectedEntryTitle}</span>.
                    AI will use its title, logline, and genre as context.
                  </p>
                )}

                <BrainDumpUploader
                  briefId={currentBriefId}
                  onExtracted={(text, filename) => {
                    const header = `\n\n--- ${filename} ---\n`;
                    setRawText((prev) => (prev ? prev + header + text : header.trimStart() + text));
                    toast.success(`Appended extracted text from ${filename} to your dump.`);
                  }}
                />

                <Textarea
                  placeholder="Don't worry about order. Just dump everything: characters, scenes, snippets of dialogue, themes, images, what-ifs, fragments..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="min-h-[420px] font-mono text-sm"
                  maxLength={500000}
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {rawText.length.toLocaleString()} / 500,000 chars
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={organizing}
                      onClick={async () => {
                        if (!user) return;
                        const { data, error } = await supabase
                          .from("brain_dump_files")
                          .select("filename, extracted_text")
                          .eq("user_id", user.id)
                          .eq("extraction_status", "done")
                          .not("extracted_text", "is", null)
                          .order("created_at", { ascending: true });
                        if (error) { toast.error("Could not load stored files."); return; }
                        const rows = (data ?? []) as Array<{ filename: string; extracted_text: string | null }>;
                        const parts = rows
                          .filter((r) => (r.extracted_text ?? "").trim().length > 0)
                          .map((r) => `--- ${r.filename} ---\n${r.extracted_text}`);
                        if (parts.length === 0) { toast.error("No extracted text in stored files yet."); return; }
                        const joined = parts.join("\n\n").slice(0, 500000);
                        setRawText(joined);
                        toast.success(`Loaded ${parts.length} file${parts.length === 1 ? "" : "s"} (${joined.length.toLocaleString()} chars). Click Organize.`);
                      }}
                    >
                      <CloudUpload /> Load all stored files
                    </Button>
                    <Button onClick={handleOrganize} disabled={PAID_AI_SECURITY_HOLD || organizing || rawText.trim().length < 20}>
                      {organizing ? (
                        <><Loader2 className="animate-spin" /> Organizing…</>
                      ) : (
                        <><Sparkles /> Organize</>
                      )}
                    </Button>
                    {organizing && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelOrganize}
                        aria-label="Cancel organize job"
                        disabled={organizeStage === "canceled" || organizeStage === "done" || organizeStage === "failed"}
                      >
                        <Square className="h-4 w-4" /> Cancel
                      </Button>
                    )}
                    {!organizing && organizeStage === "failed" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleOrganize}
                        aria-label="Retry organize job"
                        disabled={PAID_AI_SECURITY_HOLD}
                      >
                        <Loader2 className="h-4 w-4" />
                        Retry{lastFailedStage ? ` from ${lastFailedStage}` : ""}
                      </Button>
                    )}
                  </div>
                  {(organizing || organizeStage === "done" || organizeStage === "canceled" || organizeStage === "failed") && (() => {
                    const stageMeta: Record<string, { label: string; pct: number }> = {
                      preparing: { label: "Preparing your brain dump…", pct: 8 },
                      sending:   { label: "Sending to the AI router…", pct: 20 },
                      thinking:  { label: "AI is organizing your ideas…", pct: 55 },
                      revealing: { label: "Streaming organized brief…", pct: 80 },
                      saving:    { label: "Saving your organized brief…", pct: 92 },
                      done:      { label: "Done — brief organized & saved.", pct: 100 },
                      canceled:  { label: "Canceled — organize job stopped.", pct: 100 },
                      failed:    {
                        label: lastFailedStage
                          ? `Failed at ${lastFailedStage}${lastErrorMsg ? ` — ${lastErrorMsg}` : ""}`
                          : `Organize failed${lastErrorMsg ? ` — ${lastErrorMsg}` : ""}`,
                        pct: lastFailedStage === "saving" ? 92 : lastFailedStage === "revealing" ? 80 : lastFailedStage === "thinking" ? 55 : lastFailedStage === "sending" ? 20 : 8,
                      },
                      idle:      { label: "", pct: 0 },
                    };
                    const meta = stageMeta[organizeStage] ?? stageMeta.preparing;
                    const chars = rawText.length.toLocaleString();
                    const isCanceled = organizeStage === "canceled";
                    const isFailed = organizeStage === "failed";
                    const renderPartial = (value: unknown): string => {
                      if (value == null) return "";
                      if (typeof value === "string") return value;
                      if (typeof value === "number" || typeof value === "boolean") return String(value);
                      if (Array.isArray(value)) {
                        return value.map((v) => {
                          if (typeof v === "string") return `• ${v}`;
                          if (v && typeof v === "object") {
                            const o = v as Record<string, unknown>;
                            const name = o.name || o.beat_name || o.verbatim || o.act;
                            const desc = o.description || o.role || o.suggested_placement;
                            return `• ${[name, desc].filter(Boolean).join(" — ")}`;
                          }
                          return `• ${JSON.stringify(v)}`;
                        }).join("\n");
                      }
                      if (typeof value === "object") {
                        return Object.entries(value as Record<string, unknown>)
                          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
                          .join("\n");
                      }
                      return JSON.stringify(value);
                    };
                    return (
                      <div
                        className={`space-y-2 rounded-md border p-3 ${isCanceled || isFailed ? "border-destructive/50 bg-destructive/10" : "border-border/60 bg-muted/30"}`}
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="flex items-center gap-2">
                            {organizing && <Loader2 className="h-3 w-3 animate-spin" />}
                            {(isCanceled || isFailed) && <X className="h-3 w-3 text-destructive" />}
                            {meta.label}
                          </span>
                          <span className="text-muted-foreground">
                            {organizeElapsed}s · {chars} chars
                            {streamPartials.length > 0 && ` · ${streamPartials.length} field${streamPartials.length === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        <Progress value={meta.pct} className="h-1.5" />
                        {isCanceled && (
                          <p className="text-xs text-muted-foreground">
                            The job was canceled. No brief was generated and your original brain dump remains unchanged.
                          </p>
                        )}
                        {organizeStage === "thinking" && organizeElapsed > 25 && (
                          <p className="text-[10px] text-muted-foreground">
                            Large dumps can take 30–60s. Keep this tab open.
                          </p>
                        )}
                        {streamPartials.length > 0 && !isCanceled && !isFailed && (
                          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded border border-border/40 bg-background/60 p-2 text-xs">
                            {streamPartials.map((p) => (
                              <div key={p.key} className="space-y-0.5">
                                <div className="font-mono text-[10px] uppercase tracking-wide text-primary/80">
                                  {p.label}
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-sans text-foreground/90">
                                  {renderPartial(p.value)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>


              </CardContent>
            </Card>

            {history.length > 0 && (
              <Card>
                <CardHeader className="space-y-3">
                  <div className="flex flex-row items-center justify-between gap-3">
                    <CardTitle className="font-display text-lg">
                      Saved Briefs
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {filteredHistory.length}/{history.length}
                      </span>
                    </CardTitle>
                    {(searchQuery || filterFormat !== "all" || filterEntryId !== ALL_ENTRIES || sortBy !== "recent") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setSearchQuery("");
                          setFilterFormat("all");
                          setFilterEntryId(ALL_ENTRIES);
                          setSortBy("recent");
                        }}
                      >
                        <X className="h-3 w-3" /> Reset
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search notes, themes, characters, beats…"
                      className="pl-8 h-8 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Select value={filterEntryId} onValueChange={setFilterEntryId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_ENTRIES}>All entries</SelectItem>
                        <SelectItem value={NO_ENTRY}>Standalone (no entry)</SelectItem>
                        {entries.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterFormat} onValueChange={setFilterFormat}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All formats</SelectItem>
                        {availableFormats.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FORMAT_OPTIONS.find((o) => o.value === f)?.label ?? f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Newest first</SelectItem>
                        <SelectItem value="oldest">Oldest first</SelectItem>
                        <SelectItem value="title">Title A→Z</SelectItem>
                        <SelectItem value="confidence">Highest confidence</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {filteredHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                      No briefs match these filters.
                    </p>
                  ) : (
                    filteredHistory.map((b) => (
                      <div
                        key={b.id}
                        className={`flex items-center justify-between rounded-md border p-2 ${
                          b.id === currentBriefId
                            ? "border-primary/60 bg-primary/5"
                            : "border-border/50"
                        }`}
                      >
                        <button
                          className="flex-1 text-left text-sm hover:text-primary"
                          onClick={() => loadBrief(b)}
                        >
                          <div className="font-semibold flex items-center gap-2">
                            <span className="truncate">{b.title || "Untitled"}</span>
                            {b.entries?.title && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] border border-primary/20 shrink-0">
                                <FileText className="h-2.5 w-2.5" />
                                <span className="max-w-[120px] truncate">{b.entries.title}</span>
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(b.created_at).toLocaleDateString()} ·{" "}
                            {((b.confidence ?? 0) * 100).toFixed(0)}% conf.
                          </div>
                        </button>
                        <ShareBriefDialog
                          briefId={b.id}
                          initialVisibility={b.visibility}
                          initialShareToken={b.share_token}
                          initialShareExpiresAt={b.share_expires_at}
                          initialHasPassword={!!b.share_password_hash}
                          onUpdated={fetchHistory}
                        />
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: organized output */}
          <div className="space-y-4">
            {organized ? (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {currentBriefId && (
                      <AttachScreenplayPicker
                        briefId={currentBriefId}
                        currentEntryId={selectedEntryId !== NO_ENTRY ? selectedEntryId : null}
                        currentEntryTitle={selectedEntryTitle}
                        onChanged={(entryId) => {
                          setSelectedEntryId(entryId ?? NO_ENTRY);
                          fetchHistory();
                        }}
                      />
                    )}
                    {currentBriefId && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {autosaveStatus === "saving" && (
                          <><CloudUpload className="h-3.5 w-3.5 animate-pulse" /> Autosaving…</>
                        )}
                        {autosaveStatus === "saved" && lastSavedAt && (
                          <><Check className="h-3.5 w-3.5 text-emerald-400" /> Saved {lastSavedAt.toLocaleTimeString()}</>
                        )}
                        {autosaveStatus === "error" && (
                          <span className="text-destructive">Autosave failed</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {currentBriefId && (
                      <BriefVersionHistory briefId={currentBriefId} onRestore={restoreVersion} />
                    )}
                    {currentBriefId && (
                      <Button
                        variant="default"
                        className="bg-gold-gradient text-primary-foreground hover:opacity-90"
                        onClick={() => setPromoteOpen(true)}
                        title="Build a Fountain scaffold from this brief and open it in the writer"
                      >
                        <Sparkles /> Promote to Draft
                      </Button>
                    )}
                    {currentBriefId && (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (PAID_AI_SECURITY_HOLD) {
                            toast.error(PAID_AI_SECURITY_MESSAGE);
                            return;
                          }
                          toast.message("Generating screenplay draft… ~20s");
                          const { data, error } = await supabase.functions.invoke(
                            "seed-screenplay-draft",
                            { body: { brief_id: currentBriefId } },
                          );
                          if (error) return toast.error(error.message);
                          const errMsg = (data as { error?: string })?.error;
                          if (errMsg) return toast.error(errMsg);
                          const draftId = (data as { draft_id?: string })?.draft_id;
                          if (draftId) window.location.href = `/entry/${draftId}#write`;
                        }}
                        disabled={PAID_AI_SECURITY_HOLD}
                        title="AI writes a full first draft from the brief (~20s)"
                      >
                        <Sparkles /> AI Draft Screenplay
                      </Button>
                    )}
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="animate-spin" /> : <Save />}
                      {currentBriefId ? "Update Brief" : "Save as Project Brief"}
                    </Button>
                  </div>
                </div>
                {promoteController.hasActivity && (
                  <PromoteTimelinePanel
                    controller={promoteController}
                    onReopen={() => setPromoteOpen(true)}
                  />
                )}
                <OrganizedBriefCard brief={organized} />
                <SceneOutlinePanel
                  brief={organized}
                  userId={user?.id}
                  briefId={currentBriefId}
                  initialOutline={currentOutline}
                  onSaved={(o) => setCurrentOutline(o)}
                  onOutlineChange={(o) => setCurrentOutline(o)}
                  highlightedBeat={highlightedBeat}
                />
                <BeatSceneMapPanel
                  brief={organized}
                  outline={currentOutline}
                  highlightedBeat={highlightedBeat}
                  onHighlight={setHighlightedBeat}
                />
                {currentBriefId && <BriefComments briefId={currentBriefId} isOwner />}
                {currentBriefId && <BriefCommentAuditLog briefId={currentBriefId} />}
                {currentBriefId && selectedEntryId !== NO_ENTRY && (
                  <ScreenplayBriefThread
                    entryId={selectedEntryId}
                    entryTitle={entries.find((e) => e.id === selectedEntryId)?.title ?? null}
                    briefId={currentBriefId}
                    latestVersionId={latestVersionId}
                  />
                )}
              </>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-20 text-center text-muted-foreground">
                  <Sparkles className="mx-auto mb-3 text-primary" />
                  <p>Your organized brief will appear here.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        </>
        )}

      </div>
      <PromoteBriefDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        controller={promoteController}
        brief={organized}
        briefId={currentBriefId}
        briefTitle={title || organized?.logline?.slice(0, 80) || null}
        userId={user?.id ?? null}
        genre={genre || null}
      />
    </Layout>
  );
}
