/**
 * usePromoteBrief
 *
 * Shared state machine that promotes an organized Brain Dump brief into a
 * new screenplay draft. Exposes per-step state, live logs, generated
 * artifacts, and last error so BOTH the modal stepper and the inline
 * Brain Dump timeline panel can render the same live progress AND power
 * a "step details" drawer that lets users inspect what happened.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildBriefDraftScaffold } from "@/lib/buildBriefDraftScaffold";
import { mirrorArtifact } from "@/lib/projectMirror";
import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";

export type PromoteStepId = "scaffold" | "draft" | "version" | "link" | "open";
export type PromoteStepState = "pending" | "running" | "done" | "error";
export type PromoteLogLevel = "info" | "warn" | "error" | "success";

export interface PromoteLogEntry {
  ts: number;
  level: PromoteLogLevel;
  message: string;
}

export interface PromoteStepArtifact {
  /** Stable key so UI can group entries (e.g. "scaffold.title"). */
  key: string;
  label: string;
  /** Optional language hint for code rendering ("json", "fountain", "text"). */
  language?: "json" | "fountain" | "text";
  value: string;
}

export interface PromoteStep {
  id: PromoteStepId;
  label: string;
  hint: string;
}

export const PROMOTE_STEPS: PromoteStep[] = [
  { id: "scaffold", label: "Compose Title Page & outline", hint: "Building Fountain scaffold from your brief" },
  { id: "draft",    label: "Create draft document",          hint: "Inserting a new screenplay_drafts row" },
  { id: "version",  label: "Snapshot initial version",       hint: "Recording the seed in version history" },
  { id: "link",     label: "Link draft to brief",            hint: "Stamping promotion metadata on the brief" },
  { id: "open",     label: "Open in workspace",              hint: "Switching you into Write mode" },
];

const INITIAL_STATE: Record<PromoteStepId, PromoteStepState> = {
  scaffold: "pending",
  draft: "pending",
  version: "pending",
  link: "pending",
  open: "pending",
};

const emptyMap = <T,>(): Record<PromoteStepId, T[]> => ({
  scaffold: [], draft: [], version: [], link: [], open: [],
});

const emptyTimings = (): Record<PromoteStepId, { startedAt: number | null; finishedAt: number | null }> => ({
  scaffold: { startedAt: null, finishedAt: null },
  draft:    { startedAt: null, finishedAt: null },
  version:  { startedAt: null, finishedAt: null },
  link:     { startedAt: null, finishedAt: null },
  open:     { startedAt: null, finishedAt: null },
});

const emptyErrors = (): Record<PromoteStepId, string | null> => ({
  scaffold: null, draft: null, version: null, link: null, open: null,
});

export interface PromoteInput {
  brief: OrganizedBrief | null;
  briefId: string | null;
  briefTitle: string | null;
  userId: string | null;
  authorName?: string | null;
  genre?: string | null;
}

export function usePromoteBrief() {
  const navigate = useNavigate();
  const [states, setStates] = useState<Record<PromoteStepId, PromoteStepState>>(INITIAL_STATE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [resultDraftId, setResultDraftId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [finishedAt, setFinishedAt] = useState<Date | null>(null);

  // Per-step instrumentation, all keyed by PromoteStepId.
  const [logs, setLogs] = useState<Record<PromoteStepId, PromoteLogEntry[]>>(() => emptyMap<PromoteLogEntry>());
  const [artifacts, setArtifacts] = useState<Record<PromoteStepId, PromoteStepArtifact[]>>(() => emptyMap<PromoteStepArtifact>());
  const [errors, setErrors] = useState<Record<PromoteStepId, string | null>>(() => emptyErrors());
  const [timings, setTimings] = useState<ReturnType<typeof emptyTimings>>(() => emptyTimings());

  const reset = useCallback(() => {
    setStates(INITIAL_STATE);
    setErrorMessage(null);
    setResultDraftId(null);
    setStartedAt(null);
    setFinishedAt(null);
    setRunning(false);
    setLogs(emptyMap<PromoteLogEntry>());
    setArtifacts(emptyMap<PromoteStepArtifact>());
    setErrors(emptyErrors());
    setTimings(emptyTimings());
  }, []);

  const mark = useCallback((id: PromoteStepId, state: PromoteStepState) => {
    setStates((prev) => ({ ...prev, [id]: state }));
    setTimings((prev) => {
      const next = { ...prev };
      if (state === "running") next[id] = { startedAt: Date.now(), finishedAt: null };
      else if (state === "done" || state === "error") {
        const t = next[id] ?? { startedAt: null, finishedAt: null };
        next[id] = { startedAt: t.startedAt, finishedAt: Date.now() };
      }
      return next;
    });
  }, []);

  const log = useCallback((id: PromoteStepId, level: PromoteLogLevel, message: string) => {
    setLogs((prev) => ({
      ...prev,
      [id]: [...prev[id], { ts: Date.now(), level, message }],
    }));
  }, []);

  const setArtifact = useCallback((id: PromoteStepId, artifact: PromoteStepArtifact) => {
    setArtifacts((prev) => {
      const existing = prev[id];
      const filtered = existing.filter((a) => a.key !== artifact.key);
      return { ...prev, [id]: [...filtered, artifact] };
    });
  }, []);

  const setStepError = useCallback((id: PromoteStepId, message: string | null) => {
    setErrors((prev) => ({ ...prev, [id]: message }));
  }, []);

  const run = useCallback(
    async (input: PromoteInput) => {
      const { brief, briefId, briefTitle, userId, authorName, genre } = input;
      if (!brief || !briefId || !userId) {
        setErrorMessage("Missing brief or user context.");
        return null;
      }
      setRunning(true);
      setErrorMessage(null);
      setResultDraftId(null);
      setStates(INITIAL_STATE);
      setStartedAt(new Date());
      setFinishedAt(null);
      setLogs(emptyMap<PromoteLogEntry>());
      setArtifacts(emptyMap<PromoteStepArtifact>());
      setErrors(emptyErrors());
      setTimings(emptyTimings());

      try {
        // ── 1. Scaffold ────────────────────────────────────────
        mark("scaffold", "running");
        log("scaffold", "info", "Composing Fountain scaffold from organized brief…");
        const scaffold = buildBriefDraftScaffold(brief, { title: briefTitle, authorName, genre });
        log("scaffold", "info", `Format: ${scaffold.format} · target ${scaffold.targetPageCount ?? "—"} pages`);
        log("scaffold", "info", `Generated ${scaffold.fountain.length.toLocaleString()} chars of Fountain.`);
        setArtifact("scaffold", { key: "scaffold.title", label: "Title", value: scaffold.title });
        setArtifact("scaffold", {
          key: "scaffold.meta",
          label: "Scaffold metadata",
          language: "json",
          value: JSON.stringify(
            {
              title: scaffold.title,
              format: scaffold.format,
              target_page_count: scaffold.targetPageCount,
              fountain_chars: scaffold.fountain.length,
              fountain_lines: scaffold.fountain.split("\n").length,
              brief_beats: brief.plot_beats?.length ?? 0,
              brief_characters: brief.characters?.length ?? 0,
            },
            null,
            2,
          ),
        });
        setArtifact("scaffold", {
          key: "scaffold.fountain",
          label: "Fountain preview",
          language: "fountain",
          value: scaffold.fountain.length > 4000
            ? scaffold.fountain.slice(0, 4000) + "\n\n… (truncated for preview)"
            : scaffold.fountain,
        });
        await new Promise((r) => setTimeout(r, 250));
        log("scaffold", "success", "Scaffold ready.");
        mark("scaffold", "done");

        // ── 2. Create draft row ────────────────────────────────
        mark("draft", "running");
        log("draft", "info", "Inserting screenplay_drafts row…");
        const { data: draft, error: draftErr } = await supabase
          .from("screenplay_drafts")
          .insert({
            user_id: userId,
            title: scaffold.title,
            format: scaffold.format,
            fountain_text: scaffold.fountain,
            brief_id: briefId,
            target_page_count: scaffold.targetPageCount,
          })
          .select("id")
          .single();
        if (draftErr || !draft) {
          const msg = draftErr?.message ?? "Could not create draft.";
          log("draft", "error", msg);
          setStepError("draft", msg);
          throw new Error(msg);
        }
        log("draft", "success", `Draft created — id ${draft.id}`);
        setArtifact("draft", { key: "draft.id", label: "Draft id", value: draft.id });
        setArtifact("draft", { key: "draft.brief_id", label: "Brief id", value: briefId });
        mark("draft", "done");
        setResultDraftId(draft.id);

        // ── 3. Snapshot version ────────────────────────────────
        mark("version", "running");
        log("version", "info", "Recording initial version snapshot…");
        const promotionCorrelation =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : null;
        const { error: versionErr } = await supabase
          .from("screenplay_draft_versions")
          .insert({
            draft_id: draft.id,
            user_id: userId,
            fountain_text: scaffold.fountain,
            title: scaffold.title,
            source: "promote_brief",
            trigger_action: "promote_brief",
            trigger_function: "promoteBriefToScreenplay",
            correlation_id: promotionCorrelation,
            trigger_metadata: {
              brief_id: briefId,
              origin: "usePromoteBrief",
            } as never,
          });
        if (versionErr) {
          const msg = `Version snapshot failed: ${versionErr.message}`;
          log("version", "warn", msg);
          setStepError("version", versionErr.message);
          mark("version", "error");
        } else {
          log("version", "success", "Initial version recorded.");
          setArtifact("version", {
            key: "version.source",
            label: "Source",
            value: "promote_brief",
          });
          if (promotionCorrelation) {
            setArtifact("version", {
              key: "version.correlation_id",
              label: "Correlation id",
              value: promotionCorrelation,
            });
          }
          mark("version", "done");
        }

        // ── 4. Link draft to brief ─────────────────────────────
        mark("link", "running");
        log("link", "info", "Stamping promotion metadata on the brief…");
        const promotedAt = new Date().toISOString();
        const stampedOrganized = {
          ...(brief as Record<string, unknown>),
          promoted_to_draft_id: draft.id,
          promoted_at: promotedAt,
        };
        const { error: linkErr } = await supabase
          .from("project_briefs")
          .update({ organized: stampedOrganized })
          .eq("id", briefId);
        if (linkErr) {
          const msg = `Brief link stamp failed: ${linkErr.message}`;
          log("link", "warn", msg);
          setStepError("link", linkErr.message);
          mark("link", "error");
        } else {
          log("link", "success", "Brief stamped with draft id.");
          setArtifact("link", {
            key: "link.stamp",
            label: "Promotion stamp",
            language: "json",
            value: JSON.stringify(
              { promoted_to_draft_id: draft.id, promoted_at: promotedAt },
              null,
              2,
            ),
          });
          mark("link", "done");
        }

        // Mirror brief + draft into unified projects (gated; fire-and-forget).
        void mirrorArtifact({
          source: "project_briefs",
          sourceId: briefId,
          artifactType: "brief",
          payload: { promoted_to_draft_id: draft.id },
        });
        void mirrorArtifact({
          source: "screenplay_drafts",
          sourceId: draft.id,
          artifactType: "fountain",
          payload: { from_brief: briefId },
        });

        // ── 5. Open in workspace ───────────────────────────────
        mark("open", "running");
        const target = `/entry/${draft.id}#write`;
        log("open", "info", `Navigating to ${target}`);
        setArtifact("open", { key: "open.route", label: "Route", value: target });
        await new Promise((r) => setTimeout(r, 350));
        log("open", "success", "Workspace ready.");
        mark("open", "done");

        setFinishedAt(new Date());
        toast.success("Brief promoted to draft", { description: "Opening the unified workspace…" });
        navigate(target);
        return draft.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Promotion failed.";
        setErrorMessage(msg);
        setStates((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(next) as PromoteStepId[]) {
            if (next[id] === "running") {
              next[id] = "error";
              setStepError(id, msg);
            }
          }
          return next;
        });
        setFinishedAt(new Date());
        toast.error(msg);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [mark, log, setArtifact, setStepError, navigate],
  );

  const allDone = PROMOTE_STEPS.every((s) => states[s.id] === "done");
  const hasActivity = running || resultDraftId !== null || errorMessage !== null;

  return {
    states,
    errorMessage,
    running,
    resultDraftId,
    startedAt,
    finishedAt,
    allDone,
    hasActivity,
    logs,
    artifacts,
    errors,
    timings,
    run,
    reset,
  };
}
