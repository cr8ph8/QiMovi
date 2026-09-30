// Chapter admin surface — only visible to chapter creators.
// Allows starting a new reading cycle and managing existing cycles.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarDays, PlusCircle, Shield } from "lucide-react";
import { StatusPill } from "@/components/donor/StatusPill";
import type { ReaderChapter, CycleTier } from "@/lib/club/queries";

export function ChapterAdmin({ chapter, onChange }: { chapter: ReaderChapter; onChange?: () => void }) {
  const { user } = useAuth();
  const isAdmin = !!user && user.id === chapter.creator_id;

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [pages, setPages] = useState(30);
  const [tier, setTier] = useState<CycleTier>("weekly");
  const [submitting, setSubmitting] = useState(false);
  const [cycles, setCycles] = useState<any[]>([]);

  const reload = async () => {
    const { data } = await supabase
      .from("reading_cycles" as any)
      .select("*")
      .eq("chapter_id", chapter.id)
      .order("end_date", { ascending: false });
    setCycles((data as any[]) ?? []);
  };

  useEffect(() => { if (isAdmin) reload(); }, [chapter.id, isAdmin]);

  if (!isAdmin) return null;

  const startCycle = async () => {
    if (!title.trim()) { toast.error("Cycle title required"); return; }
    setSubmitting(true);
    const days = tier === "weekly" ? 7 : 30;
    const start = new Date();
    const end = new Date(Date.now() + days * 86400_000);
    const { error } = await supabase.from("reading_cycles" as any).insert({
      chapter_id: chapter.id,
      tier,
      status: "active",
      screenplay_title: title.trim(),
      screenplay_author: author.trim() || null,
      screenplay_genre: genre.trim() || null,
      total_pages: Math.max(1, pages),
      start_date: start.toISOString(),
      end_date: end.toISOString(),
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    setTitle(""); setAuthor(""); setGenre("");
    toast.success(`Started ${tier} cycle for "${title}"`);
    reload();
    onChange?.();
  };

  const closeCycle = async (id: string) => {
    const { error } = await supabase.from("reading_cycles" as any).update({ status: "closed" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Cycle closed");
    reload();
    onChange?.();
  };

  return (
    <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-5">
      <header className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Chapter admin · {chapter.name}</h3>
        <StatusPill tone="gold">Admin</StatusPill>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Screenplay title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lighthouse" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Author (optional)</Label>
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Genre (optional)</Label>
          <Input value={genre} onChange={(e) => setGenre(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Pages</Label>
            <Input type="number" min={1} value={pages} onChange={(e) => setPages(parseInt(e.target.value) || 1)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as CycleTier)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly (7d)</SelectItem>
                <SelectItem value="monthly">Monthly (30d)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Button onClick={startCycle} disabled={submitting} size="sm" className="mt-4">
        <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
        {submitting ? "Starting…" : "Start cycle"}
      </Button>

      {cycles.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Cycles</p>
          {cycles.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-border bg-background/40 p-3 text-xs">
              <div>
                <p className="font-medium">{c.screenplay_title}</p>
                <p className="text-muted-foreground flex items-center gap-1 mt-0.5">
                  <CalendarDays className="h-3 w-3" />
                  ends {new Date(c.end_date).toLocaleDateString()} · {c.tier}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={c.status === "active" ? "success" : c.status === "closed" ? "neutral" : "info"}>
                  {c.status}
                </StatusPill>
                {c.status === "active" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => closeCycle(c.id)}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChapterAdmin;
