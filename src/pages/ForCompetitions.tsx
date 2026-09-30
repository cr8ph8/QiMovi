import { Link } from "react-router-dom";
import { ArrowRight, Trophy, ClipboardCheck, EyeOff, AlertTriangle, FileCheck, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";

const FEATURES = [
  { icon: Layers, title: "Bulk script analysis", body: "Score entire entry windows in a single workflow." },
  { icon: Trophy, title: "Authorship Integrity Score", body: "Composite signal for craft + originality + provenance." },
  { icon: ClipboardCheck, title: "AI usage declaration", body: "Built-in disclosure flow for every submission." },
  { icon: EyeOff, title: "Blind review mode", body: "Strip identifying metadata before judges read." },
  { icon: AlertTriangle, title: "Risk flags", body: "Surface high-similarity or low-provenance entries to coordinators." },
  { icon: FileCheck, title: "Exportable certificates", body: "Hashed integrity snapshots travel with finalists." },
];

export default function ForCompetitions() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-4xl space-y-12">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-mono uppercase tracking-widest">
            For Competitions & Festivals
          </span>
          <h1 className="font-display text-5xl font-bold">
            Evaluate craft. <span className="text-gradient-gold">Screen for integrity.</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            CanIScreenwrite helps competitions, labs, fellowships, and festivals
            evaluate craft while screening for authorship integrity, AI influence,
            and originality risk.
          </p>
          <Button asChild size="lg" className="bg-gold-gradient text-primary-foreground hover:opacity-90">
            <Link to="/pricing">Studio Pricing <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-border/60">
              <CardContent className="p-6 space-y-2">
                <f.icon className="h-6 w-6 text-gold" />
                <h3 className="font-display text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <ShieldDisclaimer />
      </div>
    </div>
  );
}
