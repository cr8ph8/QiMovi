import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Award,
  Download,
  Shield,
  Sparkles,
  Eye,
  Layers,
  Brain,
  Users,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { ScoreMeter } from "@/components/shield/ScoreMeter";
import { RiskBadge } from "@/components/shield/RiskBadge";
import { QuotientRadar } from "@/components/shield/QuotientRadar";
import { DraftLineageTimeline, type LineageStep } from "@/components/shield/DraftLineageTimeline";
import { WhatThisMeansBox } from "@/components/shield/WhatThisMeansBox";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";
import { CertificatePreviewModal } from "@/components/shield/CertificatePreviewModal";
import {
  certificateStatusFor,
  RISK_RECOMMENDATIONS,
  type ShieldScores,
  type RiskBand,
} from "@/lib/shield/scoring";

const INFLUENCE_LABEL: Record<string, string> = {
  human_led: "Human-led",
  ai_assisted: "AI-assisted",
  ai_heavy: "AI-heavy",
  unclear: "Unclear",
  high_risk_synthetic: "High-risk synthetic",
};

export default function ShieldReport() {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<any>(null);
  const [scores, setScores] = useState<ShieldScores | null>(null);
  const [loading, setLoading] = useState(true);
  const [certOpen, setCertOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: sub }, { data: sc }] = await Promise.all([
        supabase.from("authorship_submissions").select("*").eq("id", id).single(),
        supabase.from("authorship_scores").select("*").eq("submission_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setSubmission(sub);
      setScores(sc as ShieldScores);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cinema pt-24 pb-16">
        <div className="container max-w-5xl space-y-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!submission || !scores) {
    return (
      <div className="min-h-screen bg-cinema pt-24 pb-16">
        <div className="container max-w-3xl text-center space-y-4">
          <Shield className="h-12 w-12 text-shield mx-auto" />
          <h1 className="font-display text-2xl">Shield report not found</h1>
          <Button asChild variant="outline"><Link to="/shield/analyze">Run a new analysis</Link></Button>
        </div>
      </div>
    );
  }

  const cert = certificateStatusFor(scores);
  const lineage: LineageStep[] = [
    { label: "Draft uploaded", icon: "upload", status: "complete", timestamp: submission.created_at, detail: `${submission.text_length?.toLocaleString() ?? "—"} characters` },
    { label: "Metadata declared", icon: "metadata", status: "complete", timestamp: submission.created_at, detail: `Rights: ${submission.rights_status} • Market: ${submission.intended_market}` },
    { label: "AI usage declared", icon: "ai", status: "complete", timestamp: submission.created_at, detail: submission.ai_used ? `Type: ${submission.ai_usage_type}` : "No AI tools declared" },
    { label: "Qi Shield analysis completed", icon: "analysis", status: "complete", timestamp: submission.updated_at },
    { label: "Authorship certificate", icon: "certificate", status: "pending", detail: "Issue certificate to lock this snapshot." },
  ];

  return (
    <div className="min-h-screen bg-cinema pt-24 pb-16">
      <div className="container max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to="/shield/analyze"><ArrowLeft className="h-4 w-4 mr-1" /> New analysis</Link>
            </Button>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-shield/40 bg-shield/10 text-shield text-[11px] font-mono uppercase tracking-widest">
              <Shield className="h-3 w-3" /> Qi Authorship Shield Report
            </span>
            <h1 className="font-display text-3xl md:text-4xl font-bold mt-2">{submission.project_title}</h1>
            <p className="text-sm text-muted-foreground">
              {submission.writer_name ?? "Anonymous"} • Draft {submission.draft_number ?? "—"} • {new Date(submission.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <RiskBadge band={scores.risk_band as RiskBand} />
            <Button onClick={() => setCertOpen(true)} className="bg-shield-gradient text-shield-ivory hover:opacity-90">
              <Award className="h-4 w-4 mr-2" /> Issue Authorship Certificate
            </Button>
          </div>
        </div>

        <ShieldDisclaimer />

        {/* A. Authorship Integrity Score (hero) */}
        <Card className="border-shield/30 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-shield-gradient" />
          <CardContent className="p-8 grid md:grid-cols-[auto_1fr] gap-8 items-center">
            <ScoreMeter
              value={scores.authorship_integrity_score}
              label="Authorship Integrity"
              sublabel="/ 100"
              size={180}
              variant="shield"
            />
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-widest text-shield">Section A</span>
                <h2 className="font-display text-2xl">Authorship Integrity Score</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A headline measurement of how original, traceable, human-led, and provenance-safe this draft appears.
                Blends originality, voice distinctiveness, human revision, and provenance — penalized by protected-style and market-substitution risk.
              </p>
              <p className="text-sm text-foreground italic border-l-2 border-shield pl-3">
                {RISK_RECOMMENDATIONS[scores.risk_band as RiskBand]}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* B, E, G — Composite meters */}
        <div className="grid md:grid-cols-4 gap-4">
          <Card><CardContent className="p-6 flex justify-center"><ScoreMeter value={scores.originality_score} label="Originality Quotient" /></CardContent></Card>
          <Card><CardContent className="p-6 flex justify-center"><ScoreMeter value={scores.voice_distinctiveness_score} label="Voice Distinctiveness" /></CardContent></Card>
          <Card><CardContent className="p-6 flex justify-center"><ScoreMeter value={scores.human_revision_score} label="Human Revision Quotient" /></CardContent></Card>
          <Card><CardContent className="p-6 flex justify-center"><ScoreMeter value={scores.provenance_score} label="Provenance Score" /></CardContent></Card>
        </div>

        {/* C. Recursive Voice Signature */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-gold" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold">Section C</span>
            </div>
            <CardTitle className="font-display">Recursive Voice Signature</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-[1fr_320px] gap-6 items-center">
            <QuotientRadar scores={scores} />
            <div className="space-y-2 text-sm">
              {[
                ["Syntax", scores.syntax_quotient],
                ["Rhythm", scores.rhythm_quotient],
                ["Dialogue", scores.dialogue_quotient],
                ["Scene Architecture", scores.scene_architecture_quotient],
                ["Theme", scores.theme_quotient],
                ["Character Pressure", scores.character_pressure_quotient],
                ["Emotional Temperature", scores.emotional_temperature_quotient],
                ["Genre Convention", scores.genre_convention_quotient],
                ["Cultural Texture", scores.cultural_texture_quotient],
                ["Provenance", scores.provenance_quotient],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center gap-3">
                  <span className="w-44 text-xs text-muted-foreground">{label}</span>
                  <Progress value={value as number} className="flex-1 h-1.5" />
                  <span className="w-10 text-right text-xs font-mono">{Math.round(value as number)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* D. Protected Style Similarity */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-shield" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield">Section D</span>
            </div>
            <CardTitle className="font-display">Protected Style Similarity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-[180px_1fr] gap-6 items-center">
              <ScoreMeter
                value={scores.protected_style_similarity}
                label="Style Similarity"
                variant="shield"
                size={140}
              />
              <div className="space-y-3">
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Closest pattern cluster</span>
                  <p className="font-display text-xl">{scores.protected_style_cluster}</p>
                </div>
                <WhatThisMeansBox>
                  We compare the draft's stylometric signature against neutral pattern clusters
                  — never against named living authors unless you declared them as influences.
                  Higher similarity does not mean infringement; it means rights-aware review is wise.
                </WhatThisMeansBox>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* F. AI Influence Trace */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-gold" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold">Section F</span>
            </div>
            <CardTitle className="font-display">AI Influence Trace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="px-4 py-2 rounded-md border border-gold/40 bg-gold/10 text-gold font-mono uppercase tracking-wider text-sm">
                {INFLUENCE_LABEL[scores.ai_influence_trace]}
              </span>
              <span className="text-xs text-muted-foreground">
                Declared: {submission.ai_used ? `Yes — ${submission.ai_usage_type}` : "No AI tools"}
              </span>
            </div>
            <WhatThisMeansBox>
              This is not binary AI detection. It is a creative-pattern risk estimate combining
              declared usage, human-revision level, and stylometric signals.
            </WhatThisMeansBox>
          </CardContent>
        </Card>

        {/* G. Market Substitution Risk */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-shield" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-shield">Section G</span>
            </div>
            <CardTitle className="font-display">Market Substitution Risk</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-[180px_1fr] gap-6 items-center">
            <ScoreMeter value={scores.market_substitution_risk} label="Substitution Risk" variant="shield" size={140} />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Estimates whether this work could function as a market substitute for a protected voice,
                franchise, estate, or authorial identity. Driven by similarity, permission status,
                disclosure, human revision, market category, and commercial intent.
              </p>
              <RiskBadge band={scores.risk_band as RiskBand} />
            </div>
          </CardContent>
        </Card>

        {/* H. Provenance Ledger */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-gold" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold">Section H</span>
            </div>
            <CardTitle className="font-display">Provenance Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <DraftLineageTimeline steps={lineage} />
          </CardContent>
        </Card>

        {/* Certificate summary banner */}
        <Card className="border-shield/30 bg-surface-elevated">
          <CardContent className="p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-shield">Suggested Certificate Status</p>
              <p className="font-display text-xl mt-1">{cert.label}</p>
            </div>
            <Button onClick={() => setCertOpen(true)} variant="outline" className="border-shield text-shield hover:bg-shield/10">
              <Award className="h-4 w-4 mr-2" /> Issue Certificate
            </Button>
          </CardContent>
        </Card>

        <CertificatePreviewModal
          open={certOpen}
          onOpenChange={setCertOpen}
          submission={submission}
          scores={scores}
        />
      </div>
    </div>
  );
}
