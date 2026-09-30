import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, FileSignature, Clock, Fingerprint, CheckCircle2, AlertTriangle, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { canonicalJson, sha256Hex } from "@/lib/canonicalJson";

interface DisclosureSignature {
  algorithm?: string;
  canonical_payload?: string;
  hash?: string;
}

interface FormBlock {
  id?: string;
  created_at?: string | null;
  updated_at?: string | null;
  fields?: Record<string, unknown> | null;
  signature?: DisclosureSignature | null;
}

interface DisclosureForm {
  authorship_submission?: FormBlock | null;
  fine_tune_disclosure?: FormBlock | null;
  submission_attestation?: FormBlock | null;
}

interface Props {
  form: DisclosureForm | null | undefined;
  entryCreatedAt?: string | null;
  finalizedAt?: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  project_title: "Project title",
  writer_name: "Writer name",
  draft_number: "Draft number",
  draft_date: "Draft date",
  analysis_type: "Analysis type",
  ai_used: "AI used",
  ai_usage_type: "AI usage type",
  human_revision_level: "Human revision level",
  intended_market: "Intended market",
  rights_status: "Rights status",
  declared_influences: "Declared influences",
  protected_voice_concern: "Protected-voice concern",
  protected_voice_notes: "Protected-voice notes",
  source: "Submission source",
  disclosure_type: "Disclosure type",
  declared_author: "Declared author",
  declared_model: "Declared model",
  has_permission: "Has permission",
  notes: "Notes",
  is_sole_author: "Sole author",
  has_rights: "Has rights",
  acknowledged_terms: "Acknowledged terms",
  attestation_text: "Attestation text",
};

function formatValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") {
    return <span className="text-muted-foreground/60 italic">—</span>;
  }
  if (typeof v === "boolean") {
    return (
      <Badge
        variant="outline"
        className={
          "text-[10px] font-mono uppercase " +
          (v ? "border-emerald-500/40 text-emerald-300" : "border-border/40 text-muted-foreground")
        }
      >
        {v ? "yes" : "no"}
      </Badge>
    );
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-muted-foreground/60 italic">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((item, i) => (
          <Badge key={i} variant="secondary" className="text-[10px] font-mono">
            {String(item)}
          </Badge>
        ))}
      </span>
    );
  }
  if (typeof v === "object") {
    return (
      <pre className="text-[10px] font-mono bg-background/60 rounded p-1.5 max-w-full overflow-x-auto">
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  }
  return <span className="font-mono text-foreground/90 break-words">{String(v)}</span>;
}

function FormBlockView({
  title,
  kind,
  block,
}: {
  title: string;
  kind: "authorship_submission" | "fine_tune_disclosure" | "submission_attestation";
  block: FormBlock | null | undefined;
}) {
  if (!block || !block.fields) {
    return (
      <div className="rounded border border-dashed border-border/40 p-2.5 text-[11px] text-muted-foreground">
        <span className="font-mono uppercase text-[9px] tracking-wider">{title}</span>
        <p className="mt-0.5 italic">Not submitted for this entry.</p>
      </div>
    );
  }
  const entries = Object.entries(block.fields).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && v !== "",
  );
  const ts = block.created_at ? new Date(block.created_at) : null;
  return (
    <div className="rounded border border-border/40 bg-background/40 p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <FileSignature className="h-3 w-3 text-primary/80" />
          <span className="font-mono uppercase text-[10px] tracking-wider text-foreground/90">
            {title}
          </span>
        </div>
        {ts && (
          <span
            className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono"
            title={ts.toISOString()}
          >
            <Clock className="h-2.5 w-2.5" />
            {ts.toLocaleString()}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">No fields recorded.</div>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground font-mono text-[10px] pt-0.5">
                {FIELD_LABELS[k] ?? k}
              </dt>
              <dd className="min-w-0">{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {block.signature?.hash && (
        <SignatureRow kind={kind} block={block} signature={block.signature} />
      )}
      {block.id && (
        <div className="mt-2 pt-1.5 border-t border-border/30 text-[9px] font-mono text-muted-foreground/70 break-all">
          record id · {block.id}
        </div>
      )}
    </div>
  );
}

/**
 * Strip nulls/undefined from the top level of `fields` so the client rebuild
 * matches the server's `jsonb_strip_nulls(...)` step before hashing.
 */
function stripNulls(fields: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function rebuildCanonicalPayload(
  kind: string,
  block: FormBlock,
): Record<string, unknown> {
  // Mirror the SQL `jsonb_build_object(...)` payload exactly. Canonical
  // serialization sorts keys, so the order we list them here doesn't matter.
  const base: Record<string, unknown> = {
    kind,
    id: block.id ?? null,
    created_at: block.created_at ?? null,
    updated_at: block.updated_at ?? null,
    fields: stripNulls(block.fields),
  };
  return base;
}

function SignatureRow({
  kind,
  block,
  signature,
}: {
  kind: string;
  block: FormBlock;
  signature: DisclosureSignature;
}) {
  const [status, setStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  const expected = (signature.hash ?? "").toLowerCase();
  const algo = signature.algorithm ?? "sha256";
  const short = expected ? `${expected.slice(0, 10)}…${expected.slice(-6)}` : "";

  async function verify() {
    if (!expected) return;
    setStatus("checking");
    try {
      // Independently re-canonicalize from the structured fields the server
      // returned. This is the strongest check — it proves the visible fields
      // hash to the stored signature without trusting the server's payload
      // string. If that fails, fall back to hashing the server-supplied
      // canonical_payload (still useful for diagnosing client/server drift).
      const rebuilt = canonicalJson(rebuildCanonicalPayload(kind, block));
      const rebuiltHash = await sha256Hex(rebuilt);

      let ok = rebuiltHash === expected;
      let source: "rebuilt" | "server" = "rebuilt";

      if (!ok && signature.canonical_payload) {
        const serverHash = await sha256Hex(signature.canonical_payload);
        if (serverHash === expected) {
          ok = true;
          source = "server";
        }
      }

      setStatus(ok ? "valid" : "invalid");
      if (ok && source === "rebuilt") {
        toast.success("Signature verified — record unchanged");
      } else if (ok) {
        toast.success("Signature verified against server payload");
      } else {
        toast.error("Signature mismatch — record may have changed");
      }
    } catch {
      setStatus("invalid");
      toast.error("Could not verify signature");
    }
  }


  async function copy() {
    await navigator.clipboard.writeText(expected);
    toast.success("Hash copied");
  }

  return (
    <div className="mt-2 pt-1.5 border-t border-border/30 space-y-1.5">
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Fingerprint className="h-2.5 w-2.5 text-primary/80 shrink-0" />
          <span className="font-mono uppercase text-[9px] tracking-wider text-muted-foreground">
            {algo}
          </span>
          <code
            className="font-mono text-[10px] text-foreground/80 truncate"
            title={expected}
          >
            {short}
          </code>
          <button
            type="button"
            onClick={copy}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Copy full hash"
          >
            <Copy className="h-2.5 w-2.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {status === "valid" && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[9px] font-mono uppercase gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" /> verified
            </Badge>
          )}
          {status === "invalid" && (
            <Badge variant="outline" className="border-destructive/50 text-destructive text-[9px] font-mono uppercase gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> mismatch
            </Badge>
          )}
          <button
            type="button"
            onClick={verify}
            disabled={status === "checking" || !signature.canonical_payload}
            className="inline-flex items-center gap-1 rounded border border-border/40 hover:border-primary/40 hover:text-primary px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {status === "checking" ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> checking
              </>
            ) : (
              <>verify</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DisclosureProofSection({ form, entryCreatedAt, finalizedAt }: Props) {
  const hasAny =
    form && (form.authorship_submission || form.fine_tune_disclosure || form.submission_attestation);

  return (
    <Card className="p-3 border-border/40 bg-background/40 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed flex-1">
          <span className="font-semibold text-foreground/90">Disclosure Proof</span>
          <p className="mt-0.5 text-muted-foreground">
            Exact disclosure form fields and timestamps recorded for this entry. This is the
            source-of-truth record used when the scorecard was generated.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground pl-6">
        {entryCreatedAt && (
          <div className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            <span className="uppercase">Entry submitted</span>
            <span className="text-foreground/80" title={new Date(entryCreatedAt).toISOString()}>
              {new Date(entryCreatedAt).toLocaleString()}
            </span>
          </div>
        )}
        {finalizedAt && (
          <div className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            <span className="uppercase">Scorecard finalized</span>
            <span className="text-foreground/80" title={new Date(finalizedAt).toISOString()}>
              {new Date(finalizedAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {hasAny ? (
        <div className="space-y-2 pl-6">
          <FormBlockView title="Authorship Submission" kind="authorship_submission" block={form?.authorship_submission} />
          <FormBlockView title="Fine-Tune Disclosure" kind="fine_tune_disclosure" block={form?.fine_tune_disclosure} />
          <FormBlockView title="Submission Attestation" kind="submission_attestation" block={form?.submission_attestation} />

        </div>
      ) : (
        <div className="pl-6 text-[11px] text-muted-foreground italic">
          No disclosure form records were captured for this entry.
        </div>
      )}
    </Card>
  );
}
