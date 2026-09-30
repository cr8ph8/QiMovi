import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertCircle, History, ShieldCheck, ShieldX, AlertTriangle, X, ArrowRight } from "lucide-react";

/**
 * Structured editor for a single concept payload with validation
 * and per-file admission history (populated from pipeline_concept_attempts).
 */

export interface ConceptDraft {
  fileId: string;
  filename: string;
  type: string;
  title: string;
  tags: string[];
  body: string;
  source: string;
  status?: string;
}

const CONCEPT_TYPES = ["Character", "Location", "Theme", "Beat", "Prop", "Faction", "Rule", "Note"] as const;
const STATUSES = ["draft", "active", "canonical", "deprecated"] as const;

const conceptSchema = z.object({
  type: z.string().trim().min(1, "Type is required").max(50, "Type too long"),
  title: z.string().trim().min(1, "Title is required").max(120, "Title too long"),
  status: z.enum(STATUSES),
  tags: z.array(z.string().trim().min(1).max(40)).max(12, "Max 12 tags"),
  body: z.string().trim().min(4, "Body is too short").max(4000, "Body too long"),
});

export type ConceptValidation = {
  ok: boolean;
  errors: Partial<Record<"type" | "title" | "status" | "tags" | "body", string>>;
};

export function validateConcept(d: ConceptDraft): ConceptValidation {
  const parsed = conceptSchema.safeParse({
    type: d.type,
    title: d.title,
    status: (d.status as any) || "draft",
    tags: d.tags,
    body: d.body,
  });
  if (parsed.success) return { ok: true, errors: {} };
  const errors: ConceptValidation["errors"] = {};
  for (const iss of parsed.error.issues) {
    const k = iss.path[0] as keyof ConceptValidation["errors"];
    if (k && !errors[k]) errors[k] = iss.message;
  }
  return { ok: false, errors };
}

interface Attempt {
  id: string;
  attempt_no: number;
  concept: any;
  verdict: string | null;
  stage: string | null;
  reasons: any;
  artifact_version: number | null;
  created_at: string;
}

interface Props {
  draft: ConceptDraft;
  projectId: string | null;
  onChange: (updates: Partial<ConceptDraft>) => void;
}

export default function ConceptPayloadEditor({ draft, projectId, onChange }: Props) {
  const [tagInput, setTagInput] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const validation = useMemo(() => validateConcept(draft), [draft]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !draft.fileId) return;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from("pipeline_concept_attempts" as any)
        .select("id, attempt_no, concept, verdict, stage, reasons, artifact_version, created_at")
        .eq("project_id", projectId)
        .eq("user_id", auth.user.id)
        .eq("file_id", draft.fileId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled) setAttempts((data as any[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [projectId, draft.fileId]);

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (draft.tags.includes(t)) { setTagInput(""); return; }
    onChange({ tags: [...draft.tags, t].slice(0, 12) });
    setTagInput("");
  }
  function removeTag(t: string) {
    onChange({ tags: draft.tags.filter((x) => x !== t) });
  }

  const err = validation.errors;

  return (
    <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
      {/* Left · Input */}
      <div className="p-3 rounded border border-border/40 bg-background/30 text-xs space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Input · asset</div>
        <div className="font-medium truncate">{draft.filename}</div>
        <div className="text-muted-foreground">source: <span className="font-mono">{draft.source}</span></div>
        {attempts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
          >
            <History className="h-3 w-3" />
            {attempts.length} attempt{attempts.length === 1 ? "" : "s"} · {showHistory ? "hide" : "view"} history
          </button>
        )}
        {showHistory && (
          <div className="mt-2 space-y-1.5 max-h-56 overflow-auto pr-1">
            {attempts.map((a) => (
              <AttemptRow key={a.id} attempt={a} onRestore={(c) => onChange({
                type: c.type ?? draft.type,
                title: c.title ?? draft.title,
                status: c.status ?? draft.status,
                tags: Array.isArray(c.tags) ? c.tags : draft.tags,
                body: c.body ?? draft.body,
              })} />
            ))}
          </div>
        )}
      </div>

      <div className="hidden md:flex items-center justify-center text-muted-foreground">
        <ArrowRight className="h-4 w-4" />
      </div>

      {/* Right · Structured concept editor */}
      <div className="p-3 rounded border border-primary/30 bg-primary/5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-primary/80">Output · concept payload</div>
          <div className="flex items-center gap-1">
            {validation.ok ? (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">valid</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-300 border-red-500/30">
                {Object.keys(err).length} issue{Object.keys(err).length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Type" error={err.type}>
            <Select value={CONCEPT_TYPES.includes(draft.type as any) ? draft.type : "__custom"} onValueChange={(v) => v !== "__custom" && onChange({ type: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                {CONCEPT_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                <SelectItem value="__custom" className="text-xs text-muted-foreground">Custom below…</SelectItem>
              </SelectContent>
            </Select>
            {!CONCEPT_TYPES.includes(draft.type as any) && (
              <Input value={draft.type} onChange={(e) => onChange({ type: e.target.value })} className="h-8 text-xs mt-1" placeholder="Custom type" />
            )}
          </Field>
          <Field label="Status" error={err.status}>
            <Select value={(draft.status as any) || "draft"} onValueChange={(v) => onChange({ status: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label={`Title · ${draft.title.length}/120`} error={err.title}>
          <Input value={draft.title} onChange={(e) => onChange({ title: e.target.value.slice(0, 120) })} className="h-8 text-xs" />
        </Field>

        <Field label={`Tags · ${draft.tags.length}/12`} error={err.tags}>
          <div className="flex flex-wrap gap-1 mb-1">
            {draft.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] gap-1 pr-1">
                {t}
                <button type="button" onClick={() => removeTag(t)} className="hover:text-red-400" aria-label={`Remove ${t}`}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
            onBlur={addTag}
            placeholder="Add tag + Enter"
            className="h-8 text-xs"
            disabled={draft.tags.length >= 12}
            maxLength={40}
          />
        </Field>

        <Field label={`Body · ${draft.body.length}/4000`} error={err.body}>
          <Textarea
            value={draft.body}
            onChange={(e) => onChange({ body: e.target.value.slice(0, 4000) })}
            className="text-xs min-h-[100px]"
            placeholder="Concept body — what is this, what does it mean in the story?"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
        {error && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertCircle className="h-2.5 w-2.5" />{error}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function AttemptRow({ attempt, onRestore }: { attempt: Attempt; onRestore: (c: any) => void }) {
  const v = attempt.verdict ?? "pending";
  const Icon = v === "commit" ? ShieldCheck : v === "escalate" ? AlertTriangle : ShieldX;
  const cls =
    v === "commit" ? "text-emerald-400" :
    v === "escalate" ? "text-amber-400" :
    "text-red-400";
  return (
    <div className="text-[11px] p-2 rounded border border-border/30 bg-background/40">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${cls}`} />
        <span className="font-medium">Attempt #{attempt.attempt_no}</span>
        <Badge variant="outline" className="text-[9px]">{v}</Badge>
        {attempt.stage && <Badge variant="secondary" className="text-[9px]">{attempt.stage}</Badge>}
        {attempt.artifact_version && <Badge variant="outline" className="text-[9px]">v{attempt.artifact_version}</Badge>}
        <button
          type="button"
          onClick={() => onRestore(attempt.concept)}
          className="ml-auto text-primary hover:underline text-[10px]"
        >
          Restore
        </button>
      </div>
      <div className="text-muted-foreground mt-0.5 truncate">
        {new Date(attempt.created_at).toLocaleString()} · {attempt.concept?.title ?? "(no title)"}
      </div>
    </div>
  );
}
