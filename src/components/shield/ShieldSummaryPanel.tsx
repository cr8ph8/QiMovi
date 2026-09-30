import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Shield, RefreshCw, ArrowRight, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RiskBadge } from "@/components/shield/RiskBadge";
import { ScoreMeter } from "@/components/shield/ScoreMeter";
import { CertificateBadge } from "@/components/shield/CertificateBadge";
import type { RiskBand } from "@/lib/shield/scoring";
import { EvidenceCard } from "@/components/evidence/EvidenceCard";

interface Props {
  entryId: string;
  canRecompute?: boolean;
}

interface ScoreSnapshot {
  submission_id: string;
  risk_band: RiskBand;
  authorship_integrity_score: number;
  market_substitution_risk: number;
  protected_style_similarity: number;
  originality_score: number;
  provenance_score: number;
  created_at: string;
}

interface CertificateInfo {
  certificate_number: string;
  sha256_hash: string;
  status: string;
}

export function ShieldSummaryPanel({ entryId, canRecompute = true }: Props) {
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [snapshot, setSnapshot] = useState<ScoreSnapshot | null>(null);
  const [certificate, setCertificate] = useState<CertificateInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: sub } = await supabase
      .from("authorship_submissions")
      .select("id, created_at")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) {
      setSnapshot(null);
      setCertificate(null);
      setLoading(false);
      return;
    }
    const [{ data: score }, { data: cert }] = await Promise.all([
      supabase
        .from("authorship_scores")
        .select("submission_id, risk_band, authorship_integrity_score, market_substitution_risk, protected_style_similarity, originality_score, provenance_score, created_at")
        .eq("submission_id", sub.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("authorship_certificates")
        .select("certificate_number, sha256_hash, status")
        .eq("submission_id", sub.id)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setSnapshot(score as ScoreSnapshot | null);
    setCertificate(cert as CertificateInfo | null);
    setLoading(false);
  }, [entryId]);

  useEffect(() => { load(); }, [load]);

  async function recompute(source: "entry_manual" | "admin_recompute" = "entry_manual") {
    setRecomputing(true);
    try {
      const { data, error } = await supabase.functions.invoke("compute-shield", {
        body: { entry_id: entryId, source },
      });
      if (error) throw error;
      if ((data as any)?.throttled) {
        toast.message("Shield already scored within last minute.");
      } else {
        toast.success("Shield analysis updated.");
      }
      await load();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to run Shield");
    } finally {
      setRecomputing(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (!snapshot) {
    return (
      <EvidenceCard
        title="Authorship Shield"
        icon={Shield}
        tone="shield"
        subtitle="No analysis on record"
      >
        <p className="text-sm text-muted-foreground">
          No Shield analysis has been run on this draft yet.
        </p>
        {canRecompute && (
          <Button
            onClick={() => recompute("entry_manual")}
            disabled={recomputing}
            size="sm"
            className="bg-shield-gradient text-shield-ivory hover:opacity-90"
          >
            {recomputing ? (
              <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
            ) : (
              <Shield className="h-3 w-3 mr-1.5" />
            )}
            Run Shield analysis
          </Button>
        )}
      </EvidenceCard>
    );
  }

  const shieldActions = (
    <>
      {certificate && (
        <CertificateBadge
          certificateNumber={certificate.certificate_number}
          sha256Hash={certificate.sha256_hash}
          status={certificate.status}
        />
      )}
      <div className="flex-1" />
      <Button asChild variant="outline" size="sm">
        <Link to={`/shield/report/${snapshot.submission_id}`}>
          Open full report <ArrowRight className="h-3 w-3 ml-1" />
        </Link>
      </Button>
      {canRecompute && (
        <Button
          onClick={() => recompute("entry_manual")}
          disabled={recomputing}
          variant="ghost"
          size="sm"
        >
          <RefreshCw className={`h-3 w-3 mr-1.5 ${recomputing ? "animate-spin" : ""}`} />
          Recompute
        </Button>
      )}
      {!certificate && (
        <Button asChild variant="ghost" size="sm" className="text-gold hover:text-gold">
          <Link to={`/shield/report/${snapshot.submission_id}`}>
            <Award className="h-3 w-3 mr-1.5" /> Issue certificate
          </Link>
        </Button>
      )}
    </>
  );

  const shieldReceipts = [
    {
      id: `score-${snapshot.submission_id}`,
      timestamp: snapshot.created_at,
      title: "Shield analysis computed",
      badges: [
        { label: `risk: ${snapshot.risk_band}`, tone: "primary" as const },
      ],
      notes: `Integrity ${Math.round(snapshot.authorship_integrity_score * 100)} · Originality ${Math.round(snapshot.originality_score * 100)} · Provenance ${Math.round(snapshot.provenance_score * 100)}`,
      correlationId: snapshot.submission_id,
    },
    ...(certificate
      ? [
          {
            id: `cert-${certificate.certificate_number}`,
            timestamp: snapshot.created_at,
            title: `Certificate ${certificate.certificate_number} · ${certificate.status}`,
            badges: [{ label: "certificate", tone: "success" as const }],
            hash: certificate.sha256_hash,
          },
        ]
      : []),
  ];

  return (
    <EvidenceCard
      title="Authorship Shield"
      icon={Shield}
      tone="shield"
      subtitle={`Scored ${new Date(snapshot.created_at).toLocaleString()}`}
      status={<RiskBadge band={snapshot.risk_band} />}
      actions={shieldActions}
      details={{
        triggerLabel: "Receipts",
        drawerTitle: "Authorship Shield evidence",
        drawerDescription:
          "Full trail of Shield analyses, certificates, and disclosure status for this draft.",
        disclosure: {
          label: certificate
            ? `Certified · ${certificate.status}`
            : "No certificate issued",
          tone: certificate ? "success" : "warn",
          note: certificate
            ? `SHA-256 ${certificate.sha256_hash.slice(0, 16)}…`
            : "Issue a certificate from the full report to lock in this Shield analysis.",
        },
        receipts: shieldReceipts,
        links: [
          {
            label: "Open full Shield report",
            url: `/shield/report/${snapshot.submission_id}`,
            kind: "doc",
          },
        ],
      }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
        <div className="flex justify-center">
          <ScoreMeter value={snapshot.authorship_integrity_score} label="Integrity" size={100} variant="shield" />
        </div>
        <div className="flex justify-center">
          <ScoreMeter value={snapshot.originality_score} label="Originality" size={100} />
        </div>
        <div className="flex justify-center">
          <ScoreMeter value={snapshot.provenance_score} label="Provenance" size={100} />
        </div>
        <div className="flex justify-center">
          <ScoreMeter value={snapshot.market_substitution_risk} label="Substitution Risk" size={100} variant="shield" />
        </div>
      </div>
    </EvidenceCard>
  );
}
