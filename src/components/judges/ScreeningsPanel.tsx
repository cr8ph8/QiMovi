import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Play, Square, Film, Clock, Users, ExternalLink, CheckCircle2, Lock, UserX, ClipboardEdit, Circle, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScreeningSessions } from "@/hooks/useScreeningSessions";
import { useCompetitionAudienceTotals } from "@/hooks/useAudienceVote";
import { useJudgeScoringStatus } from "@/hooks/useJudgeScoringStatus";
import { LiveJuryPanel } from "./LiveJuryPanel";
import { RecusalManager } from "./RecusalManager";
import { EntryScorecard } from "./EntryScorecard";
import { toast } from "sonner";

interface FilmEntry {
  id: string;
  film_title: string | null;
  title: string | null;
  director_name: string | null;
  runtime_seconds: number | null;
  poster_url: string | null;
  synopsis: string | null;
  ai_tools_used: string[] | null;
  video_url: string | null;
}

function fmtRuntime(s: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function ScoringStatusBadge({ status }: { status: string }) {
  if (status === "submitted") {
    return (
      <Badge variant="outline" className="border-emerald-500/60 text-emerald-400">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Scored
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="outline" className="border-amber-500/60 text-amber-400">
        <Pencil className="h-3 w-3 mr-1" /> In progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
      <Circle className="h-3 w-3 mr-1" /> Not started
    </Badge>
  );
}

function Countdown({ startedAt, runtime }: { startedAt: string; runtime: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!runtime) return null;
  const elapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  const remaining = Math.max(0, runtime - elapsed);
  return <span className="font-mono text-xs">{fmtRuntime(remaining)} remaining</span>;
}

export function ScreeningsPanel({
  competitionId,
  canEdit,
}: {
  competitionId: string;
  canEdit: boolean;
}) {
  const { sessions, startSession, endSession, finalizeSession } = useScreeningSessions(competitionId);
  const audience = useCompetitionAudienceTotals(competitionId);
  const { statusMap } = useJudgeScoringStatus(sessions.map((s) => s.entry_id));
  const [films, setFilms] = useState<Record<string, FilmEntry>>({});
  const [openLive, setOpenLive] = useState<string | null>(null);
  const [openJudges, setOpenJudges] = useState<string | null>(null);
  const [finalizeFor, setFinalizeFor] = useState<string | null>(null);
  const [finalizeReason, setFinalizeReason] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [scoringEntry, setScoringEntry] = useState<string | null>(null);


  useEffect(() => {
    const ids = sessions.map((s) => s.entry_id);
    if (!ids.length) return;
    (async () => {
      const { data } = await supabase
        .from("entries")
        .select("id,title,film_title,director_name,runtime_seconds,poster_url,synopsis,ai_tools_used,video_url")
        .in("id", ids);
      const map: Record<string, FilmEntry> = {};
      for (const f of (data ?? []) as FilmEntry[]) map[f.id] = f;
      setFilms(map);
    })();
  }, [sessions]);

  if (!sessions.length) {
    return (
      <Card className="p-8 bg-background/30 border-border/40 text-center text-sm text-muted-foreground">
        No screenings scheduled. AI Film entries get one screening session each automatically.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((s) => {
        const film = films[s.entry_id];
        const aud = audience[s.entry_id];
        const isLive = s.status === "live";
        return (
          <Card
            key={s.id}
            className={`overflow-hidden border-border/40 transition-all ${
              isLive ? "border-primary/60 shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]" : "bg-background/30"
            }`}
          >
            <div className="flex flex-col md:flex-row">
              {film?.poster_url && (
                <div className="md:w-40 h-40 md:h-auto bg-muted shrink-0">
                  <img src={film.poster_url} alt={film.film_title ?? ""} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Film className="h-3.5 w-3.5 text-primary" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        {s.status}
                      </span>
                      {isLive && s.started_at && (
                        <Badge variant="outline" className="border-primary text-primary animate-pulse">
                          ● LIVE
                        </Badge>
                      )}
                      {s.status === "locked" && (
                        <Badge variant="outline" className="border-amber-500/60 text-amber-400">
                          <Lock className="h-3 w-3 mr-1" /> Locked
                        </Badge>
                      )}
                      {s.status === "finalized" && (
                        <Badge variant="outline" className="border-emerald-500/60 text-emerald-400">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Finalized
                        </Badge>
                      )}
                      <ScoringStatusBadge status={statusMap[s.entry_id] || "not_started"} />
                    </div>
                    <h3 className="font-display text-xl">{film?.film_title || film?.title || "Untitled"}</h3>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      dir. {film?.director_name || "—"} · {fmtRuntime(film?.runtime_seconds ?? null)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && s.status === "scheduled" && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await startSession(s.id);
                            toast.success("Screening started");
                          } catch (e: any) {
                            toast.error(e.message);
                          }
                        }}
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" /> Start
                      </Button>
                    )}
                    {canEdit && isLive && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          try {
                            await endSession(s.id);
                            toast.success("Screening locked");
                          } catch (e: any) {
                            toast.error(e.message);
                          }
                        }}
                      >
                        <Square className="h-3.5 w-3.5 mr-1.5" /> End & Lock
                      </Button>
                    )}
                    {canEdit && s.status === "locked" && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setFinalizeFor(s.id);
                          setFinalizeReason("");
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Finalize
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpenJudges(openJudges === s.entry_id ? null : s.entry_id)}
                      >
                        <UserX className="h-3.5 w-3.5 mr-1.5" />
                        {openJudges === s.entry_id ? "Hide judges" : "Manage judges"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={isLive ? "default" : "outline"}
                      onClick={() => setScoringEntry(s.entry_id)}
                      disabled={s.status === "finalized"}
                      title={
                        s.status === "finalized"
                          ? "Screening finalized — scores locked"
                          : isLive
                            ? "Score this live screening"
                            : "Open scorecard"
                      }
                    >
                      <ClipboardEdit className="h-3.5 w-3.5 mr-1.5" />
                      {statusMap[s.entry_id] === "submitted"
                        ? "Edit score"
                        : statusMap[s.entry_id] === "in_progress"
                          ? "Continue scoring"
                          : isLive
                            ? "Score live"
                            : "Score"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenLive(openLive === s.entry_id ? null : s.entry_id)}
                    >
                      {openLive === s.entry_id ? "Hide" : "Live Panel"}
                    </Button>
                  </div>
                </div>

                {film?.synopsis && <p className="text-sm text-muted-foreground italic">{film.synopsis}</p>}

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  {isLive && s.started_at && film?.runtime_seconds && (
                    <span className="flex items-center gap-1.5 text-primary">
                      <Clock className="h-3 w-3" />
                      <Countdown startedAt={s.started_at} runtime={film.runtime_seconds} />
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    Audience: {aud ? `${aud.average.toFixed(1)} / 10 (${aud.count})` : "—"}
                  </span>
                  {film?.ai_tools_used?.length ? (
                    <span className="font-mono text-[10px] uppercase">{film.ai_tools_used.join(" · ")}</span>
                  ) : null}
                  {film?.video_url && (
                    <a
                      href={film.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Watch
                    </a>
                  )}
                </div>

                {s.status === "finalized" && s.finalize_reason && (
                  <div className="text-xs rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-200/90">
                    <span className="font-mono uppercase text-[10px] text-emerald-400 mr-2">Finalize reason</span>
                    {s.finalize_reason}
                  </div>
                )}

                {openJudges === s.entry_id && (
                  <div className="pt-2">
                    <RecusalManager entryId={s.entry_id} competitionId={competitionId} canEdit={canEdit} />
                  </div>
                )}

                {openLive === s.entry_id && (
                  <div className="pt-2">
                    <LiveJuryPanel entryId={s.entry_id} competitionId={competitionId} />
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      <Dialog open={!!finalizeFor} onOpenChange={(o) => !o && setFinalizeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize screening</DialogTitle>
            <DialogDescription>
              Locks all jury scores permanently and switches the public live room to a finalized leaderboard.
              Provide a short audit reason (e.g. "Jury consensus reached, no outstanding disputes").
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={finalizeReason}
            onChange={(e) => setFinalizeReason(e.target.value)}
            placeholder="Audit reason (min 4 chars)…"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeFor(null)} disabled={finalizing}>
              Cancel
            </Button>
            <Button
              disabled={finalizing || finalizeReason.trim().length < 4}
              onClick={async () => {
                if (!finalizeFor) return;
                setFinalizing(true);
                try {
                  await finalizeSession(finalizeFor, finalizeReason.trim());
                  toast.success("Screening finalized");
                  setFinalizeFor(null);
                  setFinalizeReason("");
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setFinalizing(false);
                }
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              {finalizing ? "Finalizing…" : "Finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EntryScorecard
        entryId={scoringEntry}
        open={!!scoringEntry}
        onOpenChange={(o) => !o && setScoringEntry(null)}
        canFinalize={canEdit}
      />
    </div>
  );
}
