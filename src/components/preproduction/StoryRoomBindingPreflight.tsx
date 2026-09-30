import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileCheck2,
  FileKey2,
  Loader2,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sha256Hex } from "@/lib/canonicalJson";
import {
  StoryRoomBindingPreflightError,
  buildStoryRoomBindingPreflight,
  readLocalStoryRoomBindingEvidence,
  readLocalStoryRoomContextBundle,
  serializeStoryRoomBindingPreflight,
  type LocalStoryRoomBindingEvidence,
  type LocalStoryRoomContextBundleEvidence,
  type StoryRoomBindingEvidenceRole,
} from "@/lib/storyRoomBindingPreflight";
import type { LocalStoryRoomPackPreview } from "@/lib/storyRoomPack";
import {
  compactStoryRoomWorkspaceId,
  type StoryRoomWorkspaceContext,
} from "@/lib/storyRoomWorkspaceContext";

interface StoryRoomBindingPreflightProps {
  preview: LocalStoryRoomPackPreview;
  workspaceContext: StoryRoomWorkspaceContext | null;
  contextBundle?: LocalStoryRoomContextBundleEvidence | null;
  onContextBundleChange?: (
    contextBundle: LocalStoryRoomContextBundleEvidence | null,
  ) => void;
}

interface PreparedLocalReport {
  byteLength: number;
  sha256: string;
}

const ROLE_LABELS: Record<StoryRoomBindingEvidenceRole, string> = {
  FEATURE_SCENE_OUTLINE: "feature outline",
  FEATURE_PACKAGE_MANIFEST: "feature manifest",
  SOURCE_REVISION: "optional source",
};

const RESULT_TEXT: Record<string, string> = {
  NOT_SELECTED: "Not selected",
  EXACT_MATCH: "Exact match",
  MISMATCH: "Mismatch",
  LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED: "Local hash match · not quarantined",
  LOCAL_HASH_MISMATCH_NOT_QUARANTINED: "Local hash mismatch",
  OBSERVED_UNBOUND_NO_DECLARED_HASH: "Observed · no declared source hash",
  LOCAL_SELF_HASH_AND_ROUTE_MATCH: "Self-hash + route match",
  SELF_HASH_MISMATCH: "Self-hash mismatch",
  PROJECT_MISMATCH: "Project mismatch",
  SUBJECT_MISMATCH: "Entry mismatch",
  DRAFT_SUBJECT_UNBINDABLE: "Draft cannot bind to entry context",
  ROUTE_UNBOUND: "No Stage B route to compare",
};

function compactHash(value: string | null | undefined): string {
  if (!value) return "—";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function resultTone(value: string): string {
  if (
    value === "EXACT_MATCH" ||
    value === "LOCAL_EXACT_HASH_MATCH_NOT_QUARANTINED" ||
    value === "LOCAL_SELF_HASH_AND_ROUTE_MATCH"
  ) {
    return "text-emerald-300";
  }
  if (value.includes("MISMATCH")) return "text-rose-300";
  return "text-amber-200";
}

function EvidenceHash({ value }: { value: string | null | undefined }) {
  return (
    <span className="font-mono text-[11px] text-foreground/80" title={value ?? undefined}>
      {compactHash(value)}
    </span>
  );
}

export function StoryRoomBindingPreflight({
  preview,
  workspaceContext,
  contextBundle: controlledContextBundle,
  onContextBundleChange,
}: StoryRoomBindingPreflightProps) {
  const inputRefs = useRef<Partial<Record<StoryRoomBindingEvidenceRole, HTMLInputElement | null>>>({});
  const contextInputRef = useRef<HTMLInputElement>(null);
  const [evidence, setEvidence] = useState<
    Partial<Record<StoryRoomBindingEvidenceRole, LocalStoryRoomBindingEvidence>>
  >({});
  const [localContextBundle, setLocalContextBundle] =
    useState<LocalStoryRoomContextBundleEvidence | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedLocalReport | null>(null);
  const contextBundle =
    controlledContextBundle === undefined
      ? localContextBundle
      : controlledContextBundle;

  const updateContextBundle = (
    next: LocalStoryRoomContextBundleEvidence | null,
  ) => {
    if (controlledContextBundle === undefined) setLocalContextBundle(next);
    onContextBundleChange?.(next);
  };

  const preflight = useMemo(
    () =>
      buildStoryRoomBindingPreflight({
        preview,
        workspaceContext,
        evidence,
        contextBundle,
      }),
    [contextBundle, evidence, preview, workspaceContext],
  );

  const invalidatePrepared = () => {
    setPrepared(null);
    setError(null);
  };

  const selectEvidence = async (file: File, role: StoryRoomBindingEvidenceRole) => {
    setReading(role);
    invalidatePrepared();
    try {
      const observed = await readLocalStoryRoomBindingEvidence(file, role);
      setEvidence((current) => ({ ...current, [role]: observed }));
    } catch (caught) {
      setEvidence((current) => {
        const next = { ...current };
        delete next[role];
        return next;
      });
      setError(
        caught instanceof StoryRoomBindingPreflightError
          ? caught.message
          : `Could not inspect the local ${ROLE_LABELS[role]} file.`,
      );
    } finally {
      setReading(null);
    }
  };

  const selectContextBundle = async (file: File) => {
    setReading("CONTEXT_BUNDLE");
    invalidatePrepared();
    try {
      updateContextBundle(
        await readLocalStoryRoomContextBundle(file, workspaceContext),
      );
    } catch (caught) {
      updateContextBundle(null);
      setError(
        caught instanceof StoryRoomBindingPreflightError
          ? caught.message
          : "Could not inspect the local Content Context bundle.",
      );
    } finally {
      setReading(null);
    }
  };

  const clearInputs = () => {
    setEvidence({});
    updateContextBundle(null);
    setPrepared(null);
    setError(null);
    Object.values(inputRefs.current).forEach((input) => {
      if (input) input.value = "";
    });
    if (contextInputRef.current) contextInputRef.current.value = "";
  };

  const prepareReport = async () => {
    setError(null);
    try {
      const bytes = serializeStoryRoomBindingPreflight(preflight);
      setPrepared({
        byteLength: new TextEncoder().encode(bytes).byteLength,
        sha256: await sha256Hex(bytes),
      });
    } catch (caught) {
      setPrepared(null);
      setError(
        caught instanceof StoryRoomBindingPreflightError
          ? caught.message
          : "Could not prepare the deterministic local preflight report.",
      );
    }
  };

  const featureOutline = preflight.basis.feature_scene_outline;
  const featureManifest = preflight.basis.feature_package_manifest;
  const source = preflight.basis.source;
  const context = preflight.basis.workspace_context.context_bundle;
  const hasAnySelectedInput = Object.keys(evidence).length > 0 || Boolean(contextBundle);

  return (
    <details className="border-y border-border/60 bg-black/10">
      <summary className="cursor-pointer select-none px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:px-6">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-display text-sm">
              <FileKey2 className="h-4 w-4 text-cyan-200" aria-hidden="true" />
              Admission input preflight · local verifier
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Compare exact local bytes before any future governed source-admission workflow.
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`font-mono text-[10px] ${preflight.binding_result === "MISMATCH" ? "text-rose-300" : "text-amber-200"}`}>
              {preflight.binding_result.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-rose-300">
              NOT AN ADMISSION CANDIDATE
            </Badge>
          </span>
        </span>
      </summary>

      <div className="border-t border-border/50 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Local correspondence only
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              File bytes are read and hashed in this browser. A hash match does not establish rights,
              source authority, creative approval, project membership, or permission to commit.
            </p>
          </div>
          {hasAnySelectedInput && (
            <Button type="button" variant="ghost" size="sm" onClick={clearInputs}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Clear local evidence
            </Button>
          )}
        </div>

        <div className="mt-5 overflow-x-auto border border-border/60">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="border-b border-border/60 bg-white/[0.025] font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">Input</th>
                <th className="px-3 py-2 font-normal">Declared / expected</th>
                <th className="px-3 py-2 font-normal">Observed / recomputed</th>
                <th className="px-3 py-2 font-normal">Local result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <tr>
                <td className="px-3 py-3">Story Room pack</td>
                <td className="px-3 py-3 text-muted-foreground">Exact selected bytes</td>
                <td className="px-3 py-3"><EvidenceHash value={preview.sha256} /></td>
                <td className="px-3 py-3 font-mono text-[11px] text-emerald-300">Exact bytes verified</td>
              </tr>
              <tr>
                <td className="px-3 py-3">
                  <div>Feature scene outline</div>
                  <div className="mt-1 max-w-52 truncate text-[10px] text-muted-foreground" title={evidence.FEATURE_SCENE_OUTLINE?.fileName}>
                    {evidence.FEATURE_SCENE_OUTLINE?.fileName ?? "No local file selected"}
                  </div>
                </td>
                <td className="px-3 py-3"><EvidenceHash value={featureOutline.expected_sha256} /></td>
                <td className="px-3 py-3"><EvidenceHash value={featureOutline.observed?.sha256} /></td>
                <td className={`px-3 py-3 font-mono text-[11px] ${resultTone(featureOutline.verification)}`}>
                  {RESULT_TEXT[featureOutline.verification]}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3">
                  <div>Feature package manifest</div>
                  <div className="mt-1 max-w-52 truncate text-[10px] text-muted-foreground" title={evidence.FEATURE_PACKAGE_MANIFEST?.fileName}>
                    {evidence.FEATURE_PACKAGE_MANIFEST?.fileName ?? "No local file selected"}
                  </div>
                </td>
                <td className="px-3 py-3"><EvidenceHash value={featureManifest.expected_sha256} /></td>
                <td className="px-3 py-3"><EvidenceHash value={featureManifest.observed?.sha256} /></td>
                <td className={`px-3 py-3 font-mono text-[11px] ${resultTone(featureManifest.verification)}`}>
                  {RESULT_TEXT[featureManifest.verification]}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3">
                  <div>Optional source revision</div>
                  <div className="mt-1 max-w-52 truncate text-[10px] text-muted-foreground" title={evidence.SOURCE_REVISION?.fileName}>
                    {evidence.SOURCE_REVISION?.fileName ?? "No local file selected"}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {source.declared_sha256 ? <EvidenceHash value={source.declared_sha256} /> : <span className="font-mono text-[11px] text-amber-200">Undeclared</span>}
                </td>
                <td className="px-3 py-3"><EvidenceHash value={source.observed?.sha256} /></td>
                <td className={`px-3 py-3 font-mono text-[11px] ${resultTone(source.verification)}`}>
                  {RESULT_TEXT[source.verification]}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3">Stage B route</td>
                <td className="px-3 py-3 text-muted-foreground">
                  {workspaceContext
                    ? `${workspaceContext.kind} · ${compactStoryRoomWorkspaceId(workspaceContext.projectId)}`
                    : "No valid Stage B handoff"}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {workspaceContext ? compactStoryRoomWorkspaceId(workspaceContext.subjectId) : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-[11px] text-amber-200">
                  {workspaceContext ? "Valid shape · unauthenticated" : "Absent or invalid"}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-3">
                  <div>Exported Content Context</div>
                  <div className="mt-1 max-w-52 truncate text-[10px] text-muted-foreground" title={contextBundle?.fileName}>
                    {contextBundle?.fileName ?? "No local file selected"}
                  </div>
                </td>
                <td className="px-3 py-3"><EvidenceHash value={context.declared_content_hash} /></td>
                <td className="px-3 py-3"><EvidenceHash value={context.recomputed_content_hash} /></td>
                <td className={`px-3 py-3 font-mono text-[11px] ${resultTone(context.verification)}`}>
                  {RESULT_TEXT[context.verification]}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(["FEATURE_SCENE_OUTLINE", "FEATURE_PACKAGE_MANIFEST", "SOURCE_REVISION"] as const).map((role) => (
            <span key={role}>
              <input
                ref={(node) => { inputRefs.current[role] = node; }}
                type="file"
                className="sr-only"
                aria-label={`Choose local ${ROLE_LABELS[role]} file`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectEvidence(file, role);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(reading)}
                onClick={() => inputRefs.current[role]?.click()}
              >
                {reading === role && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Choose {ROLE_LABELS[role]}
              </Button>
            </span>
          ))}
          <span>
            <input
              ref={contextInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Choose exported Content Context bundle"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void selectContextBundle(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(reading)}
              onClick={() => contextInputRef.current?.click()}
            >
              {reading === "CONTEXT_BUNDLE" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Choose exported context bundle
            </Button>
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 border-l-2 border-rose-400 pl-3 text-xs text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-border/50 pt-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Admission readiness · NOT EVALUATED
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {preflight.reason_codes.length} local limitation{preflight.reason_codes.length === 1 ? "" : "s"} recorded · {preflight.unavailable_r3_controls.length} required R3 controls unavailable.
            </p>
            {prepared && (
              <div role="status" aria-live="polite" className="mt-3 flex items-start gap-2 text-xs text-emerald-300">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Local report bytes prepared · {prepared.byteLength} B ·
                  <span className="ml-1 break-all font-mono">SHA-256 {prepared.sha256}</span>
                  <span className="mt-1 block text-muted-foreground">No file was written and no project state changed.</span>
                </span>
              </div>
            )}
          </div>
          <Button type="button" size="sm" disabled={Boolean(reading)} onClick={() => void prepareReport()}>
            <FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Prepare local preflight report
          </Button>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 font-mono text-[10px] uppercase tracking-wider sm:px-6">
        <span className="text-rose-300">NOT AN ADMISSION CANDIDATE · PRODUCE BLOCKED</span>
        <span className="text-muted-foreground">NO UPLOAD · NO PERSISTENCE · NO PROVIDER · NO SPEND</span>
      </footer>
    </details>
  );
}
