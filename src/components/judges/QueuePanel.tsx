import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowRight, Upload, Film } from "lucide-react";
import { EntryScorecard } from "./EntryScorecard";

interface QueueEntry {
  id: string;
  title: string | null;
  genre: string | null;
  status: string;
  created_at: string;
  source: string | null;
  import_batch_id: string | null;
  page_count: number | null;
  // Film-identity fields (film_title, director_name, runtime_seconds,
  // poster_url) are intentionally NOT read here — they leak writer/director
  // identity and are not projected by v_judge_entry_blind. Kept as `null`
  // in the type so the render code below still compiles.
  film_title: null;
  director_name: null;
  runtime_seconds: null;
  poster_url: null;
}

interface Props {
  competitionId: string;
  canFinalize?: boolean;
}

export function QueuePanel({ competitionId, canFinalize }: Props) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  // Roving-tabindex state: a single item in the queue holds tabIndex=0 at a
  // time so Tab moves in/out of the whole list in one stop, and Arrow keys
  // move focus between score buttons.
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("v_judge_entry_blind")
      .select("id,title,genre,status,created_at,source,import_batch_id,page_count")
      .eq("competition_id", competitionId)
      .in("status", ["submitted", "judging", "under_review"])
      .order("created_at", { ascending: true });
    setEntries(
      ((data ?? []) as Array<Omit<QueueEntry, "film_title" | "director_name" | "runtime_seconds" | "poster_url">>).map(
        (r) => ({ ...r, film_title: null, director_name: null, runtime_seconds: null, poster_url: null }),
      ),
    );
    setLoading(false);
  };


  useEffect(() => {
    load();
    const ch = supabase
      .channel(`queue:${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `competition_id=eq.${competitionId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId]);

  // Flat, visually-ordered list of entry ids drives arrow navigation across
  // batch groups so judges can sweep through the whole queue without Tab.
  const flatOrder = useMemo(() => {
    const grouped: Record<string, QueueEntry[]> = {};
    for (const e of entries) {
      const key = e.import_batch_id ?? "__direct__";
      (grouped[key] ||= []).push(e);
    }
    return Object.values(grouped).flat();
  }, [entries]);

  // Clamp focusIndex when the list shrinks (e.g. entry finalized/removed).
  useEffect(() => {
    if (focusIndex > flatOrder.length - 1) {
      setFocusIndex(Math.max(0, flatOrder.length - 1));
    }
  }, [flatOrder.length, focusIndex]);

  const moveFocus = (next: number) => {
    if (flatOrder.length === 0) return;
    const clamped = ((next % flatOrder.length) + flatOrder.length) % flatOrder.length;
    setFocusIndex(clamped);
    // Defer to next paint so the tabIndex change is applied before focusing.
    requestAnimationFrame(() => {
      buttonRefs.current[clamped]?.focus();
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        moveFocus(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(index - 1);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(0);
        break;
      case "End":
        e.preventDefault();
        moveFocus(flatOrder.length - 1);
        break;
      // Enter / Space are handled natively by <button>.
      default:
        break;
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading queue…</div>;

  if (entries.length === 0) {
    return (
      <Card className="p-6 bg-background/30 border-border/40 text-center">
        <div className="text-sm text-muted-foreground">Nothing awaiting judging in this competition.</div>
      </Card>
    );
  }

  // group by batch for clarity
  const grouped: Record<string, QueueEntry[]> = {};
  for (const e of entries) {
    const key = e.import_batch_id ?? "__direct__";
    (grouped[key] ||= []).push(e);
  }

  // Map each entry id → its flat index so nested batch loops can look up
  // the roving-tabindex position without recomputing the order.
  const flatIndexById = new Map(flatOrder.map((e, i) => [e.id, i] as const));

  return (
    <div className="space-y-4">
      <div
        role="list"
        aria-label="Judging queue entries"
        aria-describedby="queue-keyboard-help"
        className="space-y-4"
      >
        <p id="queue-keyboard-help" className="sr-only">
          Use Arrow Up and Arrow Down to move between entries. Press Home or End to jump to the first or last entry. Press Enter or Space to open the scorecard for the focused entry.
        </p>
        {Object.entries(grouped).map(([batchId, group]) => (
          <div key={batchId} className="space-y-2">
            {batchId !== "__direct__" && (
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <Upload className="h-3 w-3" /> Bulk batch · {batchId.slice(0, 8)} · {group.length} entries
              </div>
            )}
            {group.map((e) => {
              const idx = flatIndexById.get(e.id) ?? 0;
              const isFocusTarget = idx === focusIndex;
              const displayTitle = e.film_title || e.title || "Untitled";
              return (
                <button
                  key={e.id}
                  ref={(el) => { buttonRefs.current[idx] = el; }}
                  role="listitem"
                  tabIndex={isFocusTarget ? 0 : -1}
                  onFocus={() => setFocusIndex(idx)}
                  onKeyDown={(ev) => handleKeyDown(ev, idx)}
                  onClick={() => setOpenId(e.id)}
                  aria-label={`Open scorecard for ${displayTitle}, entry ${idx + 1} of ${flatOrder.length}, status ${e.status}`}
                  aria-keyshortcuts="ArrowDown ArrowUp Home End Enter"
                  className="w-full flex items-center gap-3 p-3 rounded-md border border-border/40 bg-background/40 hover:bg-background/70 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 transition-all group text-left"
                >
                  {e.film_title && e.poster_url ? (
                    <img src={e.poster_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                  ) : e.film_title ? (
                    <Film className="h-4 w-4 text-primary" aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-body text-foreground truncate">{displayTitle}</div>
                    <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                      {e.director_name ? `dir. ${e.director_name}` : (e.genre || "Unspecified")}
                      {e.runtime_seconds ? ` · ${Math.floor(e.runtime_seconds / 60)}:${String(e.runtime_seconds % 60).padStart(2, "0")}` : e.page_count ? ` · ${e.page_count}p` : ""}
                      {" · "}
                      {new Date(e.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {e.source === "bulk_import" && (
                    <Badge variant="outline" className="text-[10px] font-mono uppercase border-primary/30 text-primary">
                      bulk
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] font-mono uppercase">{e.status}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <EntryScorecard
        entryId={openId}
        open={!!openId}
        onOpenChange={(v) => !v && setOpenId(null)}
        canFinalize={canFinalize}
      />
    </div>
  );
}
