import { Link } from "react-router-dom";
import { ArrowRight, ScrollText, FileCheck2, Wand2, History, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";

const POINTS = [
  { icon: ScrollText, title: "Protect your original voice", body: "Capture the recursive signature of how you actually write." },
  { icon: Sparkles, title: "Track AI assistance honestly", body: "Disclosure raises your provenance — and your certificate status." },
  { icon: History, title: "Build a revision record", body: "Every draft adds a verifiable step to your chain-of-custody." },
  { icon: FileCheck2, title: "Prove human contribution", body: "Quantify the part of the work that is unmistakably yours." },
  { icon: Wand2, title: "Avoid accidental imitation", body: "Catch protected-style similarity before producers do." },
  { icon: Trophy, title: "Be contest- and producer-ready", body: "Walk into rooms with a hashed integrity certificate, not promises." },
];

export default function ForWriters() {
  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-4xl space-y-12">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-shield/40 bg-shield/10 text-shield text-[11px] font-mono uppercase tracking-widest">
            For Writers
          </span>
          <h1 className="font-display text-5xl font-bold">
            Your voice is your <span className="text-gradient-shield">asset</span>.<br />
            Protect the draft trail.
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Do not wait until someone asks whether your work is yours. Build the proof while you write.
          </p>
          <Button asChild size="lg" className="bg-shield-gradient text-shield-ivory hover:opacity-90">
            <Link to="/shield/analyze">Run Shield Analysis <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          {POINTS.map((p) => (
            <Card key={p.title} className="border-border/60">
              <CardContent className="p-6 space-y-2">
                <p.icon className="h-6 w-6 text-shield" />
                <h3 className="font-display text-lg">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <ShieldDisclaimer />
      </div>
    </div>
  );
}
