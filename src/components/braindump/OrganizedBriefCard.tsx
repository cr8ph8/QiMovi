import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TraditionPill } from "@/components/braindump/TraditionPill";
import type { NarrativeTradition, StructureModel } from "@/lib/narrativeTradition";
import { STRUCTURE_LABELS } from "@/lib/narrativeTradition";

export type OrganizedBrief = {
  logline?: string;
  premise?: string;
  themes?: string[];
  characters?: Array<{
    name: string;
    role?: string;
    description: string;
    want?: string;
    need?: string;
  }>;
  world?: { setting?: string; rules?: string; tone?: string };
  plot_beats?: Array<{ act?: string; beat_name: string; description: string }>;
  scene_fragments?: Array<{ verbatim: string; suggested_placement?: string }>;
  open_questions?: string[];
  suggested_format?: string;
  format_rationale?: string;
  suggested_tradition?: NarrativeTradition;
  suggested_structure_model?: StructureModel;
  kishotenketsu_beats?: { ki?: string; sho?: string; ten?: string; ketsu?: string };
  confidence?: number;
  reasoning?: string;
};

const FORMAT_LABELS: Record<string, string> = {
  vertical: "Vertical (1–5 pages)",
  micro: "Micro Short (1–5 pages)",
  short: "Short Film (6–19 pages)",
  pilot_30: "30-Min Pilot (20–40 pages)",
  pilot_60: "60-Min Pilot (45–70 pages)",
  feature: "Feature (71+ pages)",
};

export function OrganizedBriefCard({ brief }: { brief: OrganizedBrief }) {
  const conf = brief.confidence ?? 0;
  const lowConfidence = conf < 0.6;

  return (
    <div className="space-y-4">
      {lowConfidence && (
        <div className="rounded-md border border-yellow-600/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          Low confidence ({(conf * 100).toFixed(0)}%). The dump may be too sparse or scattered —
          review and refine carefully.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="font-display">Logline</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {brief.suggested_tradition && (
              <TraditionPill tradition={brief.suggested_tradition} />
            )}
            {brief.suggested_structure_model && (
              <Badge variant="outline" className="border-border/60 text-muted-foreground text-[10px]">
                {STRUCTURE_LABELS[brief.suggested_structure_model]}
              </Badge>
            )}
            {brief.suggested_format && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                {FORMAT_LABELS[brief.suggested_format] ?? brief.suggested_format}
              </Badge>
            )}
            <Badge variant="secondary">{(conf * 100).toFixed(0)}% confidence</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-base leading-relaxed">{brief.logline || "—"}</p>
          {brief.format_rationale && (
            <p className="mt-2 text-xs text-muted-foreground italic">{brief.format_rationale}</p>
          )}
        </CardContent>
      </Card>

      {brief.premise && (
        <Card>
          <CardHeader><CardTitle className="font-display">Premise</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap leading-relaxed text-sm">{brief.premise}</p>
          </CardContent>
        </Card>
      )}

      {brief.themes?.length ? (
        <Card>
          <CardHeader><CardTitle className="font-display">Themes</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {brief.themes.map((t, i) => (
              <Badge key={i} variant="outline">{t}</Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {brief.characters?.length ? (
        <Card>
          <CardHeader><CardTitle className="font-display">Characters</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {brief.characters.map((c, i) => (
              <div key={i} className="rounded-md border border-border/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {c.role && <Badge variant="secondary" className="text-xs">{c.role}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                {(c.want || c.need) && (
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    {c.want && <div><span className="text-primary">Wants:</span> {c.want}</div>}
                    {c.need && <div><span className="text-primary">Needs:</span> {c.need}</div>}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {brief.world && (brief.world.setting || brief.world.rules || brief.world.tone) ? (
        <Card>
          <CardHeader><CardTitle className="font-display">World</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {brief.world.setting && <p><span className="text-primary">Setting:</span> {brief.world.setting}</p>}
            {brief.world.rules && <p><span className="text-primary">Rules:</span> {brief.world.rules}</p>}
            {brief.world.tone && <p><span className="text-primary">Tone:</span> {brief.world.tone}</p>}
          </CardContent>
        </Card>
      ) : null}

      {brief.plot_beats?.length ? (
        <Card>
          <CardHeader><CardTitle className="font-display">Plot Beats</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {brief.plot_beats.map((b, i) => (
              <div key={i} className="border-l-2 border-primary/40 pl-3 py-1">
                <div className="flex items-center gap-2">
                  {b.act && <Badge variant="outline" className="text-xs">{b.act}</Badge>}
                  <span className="font-semibold text-sm">{b.beat_name}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{b.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {brief.kishotenketsu_beats && (brief.kishotenketsu_beats.ki || brief.kishotenketsu_beats.sho || brief.kishotenketsu_beats.ten || brief.kishotenketsu_beats.ketsu) ? (
        <Card className="border-sky-500/20">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              Kishōtenketsu View
              <Badge variant="secondary" className="text-[10px]">Relational lens</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">Four-part view: introduce → develop → turn → reconcile.</p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {brief.kishotenketsu_beats.ki && <p><span className="text-sky-400 font-mono text-xs">KI ·</span> {brief.kishotenketsu_beats.ki}</p>}
            {brief.kishotenketsu_beats.sho && <p><span className="text-sky-400 font-mono text-xs">SHŌ ·</span> {brief.kishotenketsu_beats.sho}</p>}
            {brief.kishotenketsu_beats.ten && <p><span className="text-sky-400 font-mono text-xs">TEN ·</span> {brief.kishotenketsu_beats.ten}</p>}
            {brief.kishotenketsu_beats.ketsu && <p><span className="text-sky-400 font-mono text-xs">KETSU ·</span> {brief.kishotenketsu_beats.ketsu}</p>}
          </CardContent>
        </Card>
      ) : null}

      {brief.scene_fragments?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Scene Fragments</CardTitle>
            <p className="text-xs text-muted-foreground">Preserved verbatim from your dump.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {brief.scene_fragments.map((f, i) => (
              <div key={i} className="rounded-md bg-muted/30 p-3">
                <p className="whitespace-pre-wrap font-mono text-xs">{f.verbatim}</p>
                {f.suggested_placement && (
                  <p className="mt-2 text-xs text-primary">→ {f.suggested_placement}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {brief.open_questions?.length ? (
        <Card>
          <CardHeader><CardTitle className="font-display">Open Questions</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {brief.open_questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
