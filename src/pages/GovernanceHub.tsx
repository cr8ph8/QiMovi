import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ShieldAlert,
  FileSearch,
  Scale,
  ArrowRight,
  ShieldCheck,
  Fingerprint,
  BookOpen,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * Unified Governance Hub — single entry-point for the three governance
 * subsystems: SignalCheck (editorial risk), Authorship Shield (provenance
 * certificates), and the Q2E framework (claim discipline).
 *
 * Existing deep routes (/signalcheck/*, /authorship-shield, /shield/*,
 * /framework/q2e) continue to work; this hub simply surfaces them in one
 * place so writers don't have to discover them individually.
 */
export default function GovernanceHub() {
  useDocumentTitle("Governance — SignalCheck · Authorship Shield · Q2E");

  return (
    <div className="min-h-screen bg-cinema text-foreground">
      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-primary text-xs font-mono mb-6">
          <ShieldAlert className="h-3.5 w-3.5" />
          AI Writing Governance Layer
        </div>
        <h1 className="font-display text-5xl md:text-6xl leading-tight mb-6">
          Fluency is not evidence.
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mb-8 leading-relaxed">
          One surface for the three things that keep AI-polished writing honest:
          editorial-risk signals, provenance certificates, and the Q2E claim
          discipline that ties them together.
        </p>
      </section>

      {/* Three subsystems */}
      <section className="max-w-5xl mx-auto px-6 pb-16 grid md:grid-cols-3 gap-4">
        <Card className="p-6 bg-card/60 border-border/40 flex flex-col">
          <FileSearch className="h-7 w-7 text-primary mb-3" />
          <h3 className="font-display text-xl mb-2">SignalCheck</h3>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            Analyze prose for synthetic authority, weak sourcing, inflated
            claims, and AI-style smoothing. Returns editorial risk, not a
            verdict.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild size="sm">
              <Link to="/signalcheck/analyze">
                Open Analyzer <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/signalcheck/standards">Editorial Standards</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-6 bg-card/60 border-border/40 flex flex-col">
          <ShieldCheck className="h-7 w-7 text-primary mb-3" />
          <h3 className="font-display text-xl mb-2">Authorship Shield</h3>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            Hash-chained provenance certificates for screenplays. Prove a draft
            existed at a point in time, verify any certificate by hash.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild size="sm">
              <Link to="/authorship-shield">
                Open Shield <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/shield/analyze">Analyze a Draft</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-6 bg-card/60 border-border/40 flex flex-col">
          <Scale className="h-7 w-7 text-primary mb-3" />
          <h3 className="font-display text-xl mb-2">Q2E Framework</h3>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            The claim-discipline framework underneath all of it. Every sentence
            is a proposed state update: accept, revise, escalate, or reject.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild size="sm">
              <Link to="/framework/q2e">
                Read the Framework <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/framework/narrative-traditions">
                Narrative Traditions
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      {/* Principles */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <h2 className="font-display text-2xl mb-6">Operating principles</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            {
              icon: Fingerprint,
              title: "Signal, not verdict",
              body: "AI-writing patterns are flagged as editorial risk, never as proof. False positives are expected and disclosed.",
            },
            {
              icon: ShieldAlert,
              title: "Mechanism over hype",
              body: "Synthetic authority, vague abstractions, and unsupported novelty get bounded into specific, sourced prose.",
            },
            {
              icon: BookOpen,
              title: "Provenance over polish",
              body: "Every protected mutation hits the audit log. Every artifact is hashable. Every claim is traceable.",
            },
            {
              icon: Scale,
              title: "Claim discipline (Q2E)",
              body: "Every claim is a proposed state update. Fluency does not earn ACCEPT.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <Card key={title} className="p-5 bg-card/60 border-border/40">
              <Icon className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-display text-base mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {body}
              </p>
            </Card>
          ))}
        </div>
        <div className="mt-8 text-xs text-muted-foreground">
          Admin · <Link to="/admin/narrative-gate-shadow" className="underline text-primary">Narrative Gate · Shadow Evaluation</Link>
        </div>
      </section>
    </div>
  );
}

