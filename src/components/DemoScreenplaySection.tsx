import { useMemo } from "react";
import { motion } from "framer-motion";
import { parseFountain } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import { Button } from "@/components/ui/button";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { ArrowRight, Eye } from "lucide-react";
import { Link } from "react-router-dom";

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

export default function DemoScreenplaySection() {
  const parsed = useMemo(() => parseFountain(SAMPLE_SCREENPLAY), []);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed.elements]);
  const firstPageElements = paginated.pages[0] || [];

  return (
    <Section>
      <div className="text-center mb-8">
        <SectionLabel>Preview</SectionLabel>
        <SectionTitle>See the AI Judge in Action</SectionTitle>
        <SectionDescription>
          A real screenplay scored by our AI — explore the full report, no account needed.
        </SectionDescription>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="max-w-3xl mx-auto"
      >
        {/* Stats bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border border-primary/20 border-b-0 rounded-t-xl bg-card/60 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-foreground">The Last Algorithm</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono border border-border/50 text-muted-foreground">
              ~2 pg
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono bg-muted text-muted-foreground">
              Sci-Fi / Thriller
            </span>
          </div>
          <span className="text-sm font-mono font-bold text-primary">
            82<span className="text-muted-foreground font-normal text-xs">/100</span>
          </span>
        </div>

        {/* Screenplay preview with overlay */}
        <div className="relative border border-primary/20 border-t-0 overflow-hidden bg-card/30">
          <div className="p-6 mx-auto max-w-[500px] pb-2">
            {paginated.titlePage && (
              <div className="mb-4 text-center">
                {paginated.titlePage.title && (
                  <h2 className="font-mono text-base font-bold text-foreground uppercase tracking-wide mb-1">
                    {paginated.titlePage.title}
                  </h2>
                )}
                {paginated.titlePage.credit && (
                  <p className="font-mono text-xs text-muted-foreground mb-0.5">{paginated.titlePage.credit}</p>
                )}
                {paginated.titlePage.author && (
                  <p className="font-mono text-xs text-foreground">{paginated.titlePage.author}</p>
                )}
                <hr className="border-border/30 my-3" />
              </div>
            )}
            <div className="space-y-0">
              {firstPageElements.slice(0, 18).map((el, i) => (
                <div key={i} className="font-mono text-[11px] text-secondary-foreground">
                  {el.type === "scene_heading" ? (
                    <p className="font-bold text-primary uppercase tracking-wide mt-3 mb-1 text-xs">{el.text}</p>
                  ) : el.type === "character" ? (
                    <p className="font-semibold uppercase text-center mt-2 mb-0.5 tracking-wider text-[11px]">{el.text}</p>
                  ) : el.type === "dialogue" ? (
                    <p className="text-center mx-auto max-w-[280px] leading-relaxed">{el.text}</p>
                  ) : el.type === "parenthetical" ? (
                    <p className="italic text-muted-foreground text-center mx-auto max-w-[240px]">{el.text}</p>
                  ) : el.type === "transition" ? (
                    <p className="text-muted-foreground uppercase text-right mt-2 mb-1">{el.text}</p>
                  ) : el.type === "empty" ? (
                    <div className="h-1.5" />
                  ) : (
                    <p className="leading-relaxed my-0.5">{el.text}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Fade overlay */}
          <div className="absolute inset-0 top-1/3 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none" />
        </div>

        {/* CTA card — sits below the preview, not overlapping */}
        <div className="relative border border-primary/20 border-t-0 rounded-b-xl bg-background px-6 py-8 text-center">
          <div className="max-w-md mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 mb-4">
              <Eye className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-mono tracking-wider text-primary uppercase">Full AI Report Available</span>
            </div>
            <h3 className="font-display text-xl font-bold mb-2">Explore the Complete Analysis</h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Radar charts, category scores, AI judge feedback — see exactly how our platform evaluates a screenplay.
            </p>
            <Link to="/demo">
              <Button size="lg" className="bg-gold-gradient font-body font-semibold text-primary-foreground px-10 hover:opacity-90 glow-gold">
                View Demo Profile <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>
    </Section>
  );
}
