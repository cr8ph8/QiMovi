import { Link } from "react-router-dom";
import { Brain, Crown, Lock, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function BrainDumpProGate({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
        />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Brain Dump
            <Badge className="gap-1 bg-primary/15 text-primary border border-primary/30 text-[10px] font-mono uppercase tracking-wider hover:bg-primary/20">
              <Crown className="h-2.5 w-2.5" /> Pro
            </Badge>
          </CardTitle>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/pricing">
              <Crown className="h-3.5 w-3.5" /> Upgrade
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="relative space-y-3">
          <p className="text-xs text-muted-foreground">
            Capture messy ideas and turn them into organized briefs that link directly to your
            screenplays — with autosaved drafts so you never lose a thought.
          </p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              AI-organized briefs from raw notes
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              Autosaved drafts &amp; full version history
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              Direct two-way thread with each screenplay
            </li>
          </ul>
          <div className="flex items-center gap-2 pt-1">
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/pricing">
                <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="text-xs">
              <Link to="/how-it-works">Learn more</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
      <CardContent className="p-8 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h2 className="font-display text-xl">Brain Dump is a Pro feature</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Pour unstructured thoughts in, get an organized project brief out, link it to a
            screenplay, and share it with collaborators — available on the Pro and Studio plans.
          </p>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1.5 max-w-sm mx-auto text-left">
          <li className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            AI-organized briefs from messy notes
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            Scene outlines, beat maps, and version history
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            Shareable brief pages with comments and moderation
          </li>
        </ul>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button asChild className="gap-1.5">
            <Link to="/pricing">
              <Crown className="h-4 w-4" /> Upgrade to Pro
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/how-it-works">Learn more</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
