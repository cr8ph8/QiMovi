import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Award, Copy, Download, Shield } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { certificateStatusFor, type ShieldScores } from "@/lib/shield/scoring";
import { RiskBadge } from "./RiskBadge";
import { ShieldDisclaimer } from "./ShieldDisclaimer";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeCertNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QAS-${ts}-${rand}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission: any;
  scores: ShieldScores;
}

export function CertificatePreviewModal({ open, onOpenChange, submission, scores }: Props) {
  const { user } = useAuth();
  const [issued, setIssued] = useState<{ number: string; hash: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const cert = certificateStatusFor(scores);

  const payload = {
    project_title: submission.project_title,
    writer_name: submission.writer_name,
    draft_number: submission.draft_number,
    draft_date: submission.draft_date,
    issued_at: new Date().toISOString(),
    authorship_integrity_score: scores.authorship_integrity_score,
    originality_score: scores.originality_score,
    voice_distinctiveness_score: scores.voice_distinctiveness_score,
    human_revision_score: scores.human_revision_score,
    ai_influence_trace: scores.ai_influence_trace,
    provenance_score: scores.provenance_score,
    protected_style_similarity: scores.protected_style_similarity,
    protected_style_cluster: scores.protected_style_cluster,
    market_substitution_risk: scores.market_substitution_risk,
    risk_band: scores.risk_band,
    status: cert.status,
  };

  async function handleIssue() {
    if (!user) return;
    setBusy(true);
    try {
      const number = makeCertNumber();
      const json = JSON.stringify(payload);
      const hash = await sha256Hex(json);

      const { error } = await supabase.from("authorship_certificates").insert({
        submission_id: submission.id,
        user_id: user.id,
        certificate_number: number,
        status: cert.status,
        payload: payload as any,
        sha256_hash: hash,
      });
      if (error) throw error;
      setIssued({ number, hash });
      toast.success("Authorship certificate issued");
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to issue certificate");
    } finally {
      setBusy(false);
    }
  }

  function copyHash() {
    if (!issued) return;
    navigator.clipboard.writeText(issued.hash);
    toast.success("Hash copied");
  }

  function downloadJSON() {
    const verifyUrl = issued?.hash ? `${window.location.origin}/shield/verify/${issued.hash}` : undefined;
    const blob = new Blob([JSON.stringify({ ...payload, certificate_number: issued?.number, sha256: issued?.hash, verify_url: verifyUrl }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${issued?.number ?? "certificate"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Shield className="h-5 w-5 text-shield" />
            CanIScreenwrite Authorship Certificate
          </DialogTitle>
          <DialogDescription>
            A snapshot of this draft's Qi Shield analysis, hashed for provenance.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-shield/30 rounded-lg bg-surface-elevated p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-shield">Qi Authorship Shield</p>
              <p className="font-display text-2xl">{payload.project_title}</p>
              <p className="text-xs text-muted-foreground">
                {payload.writer_name ?? "—"} • Draft {payload.draft_number ?? "—"}
              </p>
            </div>
            <RiskBadge band={scores.risk_band as any} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Integrity" value={scores.authorship_integrity_score} />
            <Stat label="Originality" value={scores.originality_score} />
            <Stat label="Human Revision" value={scores.human_revision_score} />
            <Stat label="Provenance" value={scores.provenance_score} />
            <Stat label="Style Similarity" value={scores.protected_style_similarity} />
            <Stat label="Market Subst. Risk" value={scores.market_substitution_risk} />
          </div>

          <div className="rounded-md bg-shield/10 border border-shield/30 px-4 py-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-shield mb-1">Status</p>
            <p className="font-display text-lg">{cert.label}</p>
          </div>

          {issued && (
            <div className="space-y-2 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">Certificate #</span>{" "}
                <span className="text-gold">{issued.number}</span>
              </div>
              <div className="break-all">
                <span className="text-muted-foreground">SHA-256</span>{" "}
                <span className="text-foreground">{issued.hash}</span>
              </div>
            </div>
          )}

          <ShieldDisclaimer variant="certificate" />
        </div>

        <div className="flex justify-end gap-2">
          {!issued ? (
            <Button onClick={handleIssue} disabled={busy} className="bg-shield-gradient text-shield-ivory hover:opacity-90">
              <Award className="h-4 w-4 mr-2" /> {busy ? "Issuing…" : "Issue Certificate"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={copyHash}><Copy className="h-4 w-4 mr-2" /> Copy hash</Button>
              <Button onClick={downloadJSON} className="bg-shield-gradient text-shield-ivory hover:opacity-90">
                <Download className="h-4 w-4 mr-2" /> Download JSON
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border-b border-border/30 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{Math.round(value)}</span>
    </div>
  );
}
