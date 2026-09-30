// User reading history + simple achievements summary.
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, Clock, Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuth } from "@/hooks/useAuth";
import { useMyReadingHistory } from "@/lib/club/queries";

export default function ReadingHistory() {
  useDocumentTitle("Reading History · Script Club");
  const { user } = useAuth();
  const { rows, loading } = useMyReadingHistory(100);

  const finished = rows.filter((r) => r.status === "finished");
  const inProgress = rows.filter((r) => r.status === "in_progress");
  const totalPages = rows.reduce((s, r) => s + r.pages_read, 0);
  const totalMinutes = rows.reduce((s, r) => s + r.read_minutes, 0);
  const genres = new Set(rows.map((r) => r.genre).filter(Boolean));

  if (!user) {
    return (
      <div className="container max-w-3xl pt-24 pb-16 text-center">
        <p className="text-sm text-muted-foreground">Sign in to view your reading history.</p>
        <Link to="/auth" className="text-primary hover:underline text-sm">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl pt-24 pb-16 space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Reading History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every screenplay you've opened, finished, and reviewed in Script Club.
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={CheckCircle2} value={finished.length} label="Finished" />
        <Stat icon={BookOpen} value={inProgress.length} label="In progress" />
        <Stat icon={Clock} value={`${Math.round(totalMinutes / 60)}h`} label="Time read" />
        <Stat icon={Flame} value={genres.size} label="Genres" />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">No reading activity yet.</p>
          <Link to="/script-club" className="text-primary hover:underline text-sm">Join a cycle →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.entry_id ? (
                    <Link to={`/reader/${r.entry_id}`} className="hover:text-primary">Entry {r.entry_id.slice(0, 8)}</Link>
                  ) : "Untitled entry"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.pages_read} pp · {r.read_minutes} min · started {new Date(r.started_at).toLocaleDateString()}
                </p>
              </div>
              <Badge variant={r.status === "finished" ? "default" : "secondary"} className="text-[10px] capitalize">
                {r.status.replace("_", " ")}
              </Badge>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground text-center pt-2">
        Pages read total: <span className="tabular-nums font-medium">{totalPages}</span>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: any; value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Icon className="h-4 w-4 text-primary mb-2" />
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}
