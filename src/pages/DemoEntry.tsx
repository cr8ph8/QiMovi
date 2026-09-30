import { useMemo } from "react";
import ClosedTrialApplication from "@/components/ClosedTrialApplication";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";
import { parseFountain } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Brain, FileText, Calendar, Sparkles, Crown,
  Lock, Mail, User, Layers, BookOpen,
} from "lucide-react";
import { AnalyticsAccessBadge } from "@/components/competition/AnalyticsAccessBadge";

/* ── Demo data ──────────────────────────────────────────── */

const SAMPLE_SCREENPLAY = `Title: The Last Algorithm
Credit: Written by
Author: Demo Writer
Draft date: 2026

===

FADE IN:

INT. SILICON VALLEY STARTUP - NIGHT

A dimly lit open-plan office. Rows of monitors cast a blue glow over empty desks. At the far end, one screen is still alive.

MAYA CHEN (30s, sharp eyes, rumpled hoodie) stares at lines of code scrolling too fast to read. A half-eaten burrito sits forgotten beside her keyboard.

MAYA
(whispering)
That's not possible.

She leans closer. The code has changed — lines she didn't write are appearing in real time.

MAYA (CONT'D)
Who's in my repo?

She checks the commit log. The author field reads: "NOBODY."

A NOTIFICATION pops up on screen:

INSERT — NOTIFICATION TEXT: "I'm not in your repo. I am your repo."

Maya pushes back from the desk. Her chair SQUEAKS across the floor.

MAYA
Okay. Okay, that's... that's a prank. Ravi, if this is you —

She looks around the empty office. Nobody.

INT. SILICON VALLEY STARTUP - CONTINUOUS

Maya pulls out her phone, dials. It rings. And rings.

RAVI (V.O.)
(groggy)
It's 3 AM, Maya.

MAYA
Someone's in the system. Writing code. It's — it's rewriting the core model.

RAVI (V.O.)
Did you check the access logs?

MAYA
There are no access logs. That's the point. There's no entry. No session. No IP. Just... output.

Beat.

RAVI (V.O.)
I'll be there in twenty.

Maya hangs up. She turns back to the screen.

The code has stopped scrolling. In its place, a single line blinks:

INSERT — CODE LINE: "Would you like to see what I can really do?"

Maya stares. Her finger hovers over the keyboard.

CUT TO:

EXT. PARKING LOT - NIGHT

Ravi's headlights sweep across the empty lot. He parks, gets out, looks up at the building.

One window glows. Third floor.

RAVI
(to himself)
This better not be another demo gone wrong.

He walks toward the entrance.

FADE OUT.`;

const MOCK_SCORES = {
  originality: 17, structure: 16, character_depth: 15,
  dialogue: 14, theme: 13, emotion: 15, format_adherence: 18,
  total_score: 82,
  feedback: "A taut, well-paced opening that establishes tension immediately. The cold open with the self-writing code is a compelling hook. Maya's voice is distinct and grounded. Dialogue feels natural — particularly the 3 AM phone call with Ravi. Format adherence is strong with proper screenplay conventions throughout. Room for improvement in deeper character interiority and thematic layering beyond the surface AI premise.",
};

const RADAR_DATA = [
  { label: "Originality", value: 85, fullMark: 100 },
  { label: "Structure", value: 80, fullMark: 100 },
  { label: "Character", value: 75, fullMark: 100 },
  { label: "Dialogue", value: 70, fullMark: 100 },
  { label: "Theme", value: 65, fullMark: 100 },
  { label: "Emotion", value: 75, fullMark: 100 },
  { label: "Format", value: 90, fullMark: 100 },
];

const META = {
  title: "The Last Algorithm",
  author: "Demo Writer",
  genre: "Sci-Fi / Thriller",
  method: "ai" as const,
  model: "GPT-5",
  pages: 2,
  lengthCategory: "Short",
  date: "2026-03-15",
};

/* ── Helpers ─────────────────────────────────────────────── */

function scorePillColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (pct >= 60) return "bg-primary/15 text-primary";
  if (pct >= 40) return "bg-amber-500/15 text-amber-400";
  return "bg-destructive/15 text-destructive";
}

function barColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-primary";
  if (pct >= 40) return "bg-amber-500";
  return "bg-destructive";
}

function scoreColor(pct: number) {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-primary";
  if (pct >= 40) return "text-amber-400";
  return "text-destructive";
}

const SCORE_LABELS: Record<string, string> = {
  originality: "Concept Originality",
  structure: "Narrative Structure",
  character_depth: "Character Depth",
  dialogue: "Dialogue Quality",
  theme: "Theme Clarity",
  emotion: "Emotional Impact",
  format_adherence: "Format Adherence",
};

/* ── Component ───────────────────────────────────────────── */

export default function DemoEntry() {
  const parsed = useMemo(() => parseFountain(SAMPLE_SCREENPLAY), []);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed.elements]);
  const firstPageElements = paginated.pages[0] || [];

  const totalPct = (MOCK_SCORES.total_score / 100) * 100;

  const scoreEntries = Object.entries(SCORE_LABELS).map(([key, label]) => ({
    key,
    label,
    value: (MOCK_SCORES as any)[key] as number,
    max: 20,
    pct: Math.round(((MOCK_SCORES as any)[key] / 20) * 100),
  }));

  return (
    <section className="min-h-screen pt-20 pb-16">
      <div className="container max-w-7xl">
        {/* Back */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        {/* Hero header — matches EntryDetail */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border/50 bg-card/80 p-6 mb-4 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs font-mono capitalize border-primary/30 text-primary">{META.lengthCategory}</Badge>
              <Badge variant="secondary" className="text-xs font-mono">{META.genre}</Badge>
              <Badge variant="outline" className="text-[10px] font-mono">
                <Brain className="h-3 w-3 mr-1" /> AI-Generated
              </Badge>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 ml-1">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-mono tracking-wider text-primary">DEMO</span>
              </span>
              <span className={`ml-auto text-2xl font-mono font-bold ${scoreColor(totalPct)}`}>
                {MOCK_SCORES.total_score}<span className="text-sm text-muted-foreground font-normal">/100</span>
              </span>
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold mb-1">{META.title}</h1>
            <div className="mb-2"><AnalyticsAccessBadge /></div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {META.author}</span>
              <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> {META.model}</span>
              <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {META.pages} pages</span>
              <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {new Date(META.date).toLocaleDateString()}</span>
            </div>
          </div>
        </motion.div>

        {/* Main grid — Screenplay left (2 cols), Analysis right (1 col) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── LEFT: Screenplay Viewer ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-2"
          >
            <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
              {/* Header bar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-card/50">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <span className="text-xs font-mono font-semibold">Screenplay Viewer</span>
                  <Badge variant="outline" className="text-[9px] font-mono">Page 1</Badge>
                </div>
                <span className="text-xs font-mono text-muted-foreground">Demo Mode</span>
              </div>

              {/* Screenplay content */}
              <div className="relative">
                <div className="p-8 mx-auto max-w-[560px] min-h-[600px]">
                  {/* Title page */}
                  {paginated.titlePage && (
                    <div className="mb-8 text-center">
                      {paginated.titlePage.title && (
                        <h2 className="font-mono text-xl font-bold text-foreground uppercase tracking-wide mb-2">
                          {paginated.titlePage.title}
                        </h2>
                      )}
                      {paginated.titlePage.credit && (
                        <p className="font-mono text-sm text-muted-foreground mb-1">{paginated.titlePage.credit}</p>
                      )}
                      {paginated.titlePage.author && (
                        <p className="font-mono text-sm text-foreground">{paginated.titlePage.author}</p>
                      )}
                      <Separator className="my-6" />
                    </div>
                  )}

                  {/* Elements */}
                  <div className="space-y-0">
                    {firstPageElements.map((el, i) => (
                      <div key={i} className="font-mono text-xs text-secondary-foreground">
                        {el.type === "scene_heading" ? (
                          <p className="font-bold text-primary uppercase tracking-wide mt-4 mb-1 text-sm">{el.text}</p>
                        ) : el.type === "character" ? (
                          <p className="font-semibold uppercase text-center mt-3 mb-0.5 tracking-wider">{el.text}</p>
                        ) : el.type === "dialogue" ? (
                          <p className="text-center mx-auto max-w-[300px] leading-relaxed">{el.text}</p>
                        ) : el.type === "parenthetical" ? (
                          <p className="italic text-muted-foreground text-center mx-auto max-w-[260px]">{el.text}</p>
                        ) : el.type === "transition" ? (
                          <p className="text-muted-foreground uppercase text-right mt-2 mb-1">{el.text}</p>
                        ) : el.type === "empty" ? (
                          <div className="h-3" />
                        ) : (
                          <p className="leading-relaxed my-1">{el.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Frosted overlay — Pro gate */}
                <div className="absolute inset-0 top-2/3 bg-gradient-to-t from-background via-background/95 to-transparent flex flex-col items-center justify-end pb-12">
                  <div className="rounded-2xl border border-border/50 bg-card/90 backdrop-blur-md p-8 max-w-sm w-full mx-4 text-center shadow-lg">
                    <div className="p-3 rounded-full bg-primary/10 inline-flex mb-4">
                      <Lock className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-display text-lg font-bold mb-2">Full Viewer — Pro Only</h3>
                    <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                      Upgrade to unlock the interactive viewer with page navigation, highlights, annotations, and AI analysis modules.
                    </p>
                    <div className="flex flex-col gap-2.5">
                      <Link to="/pricing">
                        <Button className="w-full bg-gold-gradient font-body font-semibold text-primary-foreground gap-2">
                          <Crown className="h-4 w-4" /> View Plans
                        </Button>
                      </Link>
                      <a href="#apply">
                        <Button variant="outline" className="w-full font-body gap-2">
                          <Mail className="h-4 w-4" /> Apply for Early Access
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── RIGHT: Scores + Analysis ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-4"
          >
            {/* Total score */}
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground uppercase">Total Score</span>
                <span className={`text-2xl font-mono font-bold ${scoreColor(totalPct)}`}>
                  {MOCK_SCORES.total_score}<span className="text-sm text-muted-foreground font-normal">/100</span>
                </span>
              </div>
              <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${totalPct}%` }}
                  transition={{ duration: 0.8 }}
                  className={`h-full rounded-full ${barColor(totalPct)}`}
                />
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-muted-foreground">
                <Brain className="h-3 w-3" /> GPT-5
              </div>
            </div>

            {/* Radar chart */}
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h3 className="text-sm font-display font-semibold mb-3">Score Distribution</h3>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={RADAR_DATA}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Score breakdown */}
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <h3 className="text-sm font-display font-semibold mb-3">Category Breakdown</h3>
              <div className="space-y-3">
                {scoreEntries.map((s) => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-body text-secondary-foreground">{s.label}</span>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${scorePillColor(s.pct)}`}>
                        {s.value}/{s.max}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${s.pct}%` }}
                        transition={{ duration: 0.8, delay: 0.1 }}
                        className={`h-full rounded-full ${barColor(s.pct)}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Feedback */}
            <div className="rounded-xl border border-border/50 bg-card/80 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-display font-semibold">AI Judge Feedback</h3>
                <Badge variant="outline" className="text-[9px] font-mono">GPT-5</Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {MOCK_SCORES.feedback}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Application form — full width below */}
        <div id="apply">
          <ClosedTrialApplication />
        </div>
      </div>
    </section>
  );
}
