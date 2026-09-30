import { useMemo } from "react";
import { GitBranch, Target, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";
import type { Outline, Scene } from "@/components/braindump/SceneOutlinePanel";

interface Props {
  brief: OrganizedBrief | null;
  outline: Outline | null;
  highlightedBeat: string | null;
  onHighlight: (beat: string | null) => void;
}

const norm = (s: string | undefined | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function BeatSceneMapPanel({ brief, outline, highlightedBeat, onHighlight }: Props) {
  const beats = brief?.plot_beats ?? [];

  // For each beat, list scenes whose beat_ref matches (substring either way).
  const beatToScenes = useMemo(() => {
    const m = new Map<string, Scene[]>();
    if (!outline) return m;
    for (const b of beats) {
      const key = norm(b.beat_name);
      const matches = outline.scenes.filter((s) => {
        const ref = norm(s.beat_ref);
        if (!ref || !key) return false;
        return ref === key || ref.includes(key) || key.includes(ref);
      });
      m.set(b.beat_name, matches);
    }
    return m;
  }, [beats, outline]);

  // Scenes whose beat_ref doesn't match any known beat.
  const orphanScenes = useMemo(() => {
    if (!outline) return [];
    const beatKeys = beats.map((b) => norm(b.beat_name));
    return outline.scenes.filter((s) => {
      const ref = norm(s.beat_ref);
      if (!ref) return true;
      return !beatKeys.some((k) => k && (k === ref || ref.includes(k) || k.includes(ref)));
    });
  }, [beats, outline]);

  if (!beats.length) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          Beat → Scene Map
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Click a beat to highlight the scenes that came from it.
          {highlightedBeat && (
            <button
              type="button"
              className="ml-2 text-primary underline underline-offset-2"
              onClick={() => onHighlight(null)}
            >
              clear highlight
            </button>
          )}
        </p>
      </CardHeader>

      <CardContent>
        {!outline ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Build a scene outline to see how each beat fans out into scenes.
          </p>
        ) : (
          <div className="space-y-2">
            {beats.map((b) => {
              const scenes = beatToScenes.get(b.beat_name) ?? [];
              const active = highlightedBeat === b.beat_name;
              const empty = scenes.length === 0;
              return (
                <button
                  key={b.beat_name}
                  type="button"
                  onClick={() => onHighlight(active ? null : b.beat_name)}
                  className={`w-full text-left rounded-md border p-3 transition-colors ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Target className="h-3.5 w-3.5 text-primary shrink-0" />
                      {b.act && (
                        <Badge variant="outline" className="text-[10px]">{b.act}</Badge>
                      )}
                      <span className="text-sm font-semibold truncate">{b.beat_name}</span>
                    </div>
                    <Badge
                      variant={empty ? "outline" : "secondary"}
                      className={empty ? "border-amber-500/40 text-amber-400" : ""}
                    >
                      {scenes.length} scene{scenes.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {b.description && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {b.description}
                    </p>
                  )}
                  {scenes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {scenes.map((s) => (
                        <Badge key={s.scene_number} variant="outline" className="text-[10px] font-mono">
                          #{s.scene_number.toString().padStart(2, "0")} · {s.slugline.slice(0, 36)}
                          {s.slugline.length > 36 ? "…" : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}

            {orphanScenes.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-semibold">
                    {orphanScenes.length} scene{orphanScenes.length === 1 ? "" : "s"} not tied to a known beat
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {orphanScenes.map((s) => (
                    <Badge key={s.scene_number} variant="outline" className="text-[10px] font-mono">
                      #{s.scene_number.toString().padStart(2, "0")} · {s.beat_ref || "no beat"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
