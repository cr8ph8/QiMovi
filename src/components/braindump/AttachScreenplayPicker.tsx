import { useEffect, useState } from "react";
import { Link2, X, Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

type EntryRow = { id: string; title: string };

type Props = {
  briefId: string;
  currentEntryId: string | null;
  currentEntryTitle?: string | null;
  onChanged?: (entryId: string | null, entryTitle: string | null) => void;
};

export function AttachScreenplayPicker({
  briefId, currentEntryId, currentEntryTitle, onChanged,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    supabase
      .from("entries")
      .select("id, title")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setEntries((data ?? []) as EntryRow[]);
        setLoading(false);
      });
  }, [open, user]);

  const setEntry = async (entry: EntryRow | null) => {
    setSaving(true);
    const { error } = await supabase
      .from("project_briefs")
      .update({ entry_id: entry?.id ?? null })
      .eq("id", briefId);
    setSaving(false);
    if (error) {
      toast.error(error.message || "Could not link screenplay.");
      return;
    }
    toast.success(entry ? `Linked to "${entry.title}"` : "Screenplay unlinked");
    setOpen(false);
    onChanged?.(entry?.id ?? null, entry?.title ?? null);
  };

  if (currentEntryId) {
    return (
      <div className="flex items-center gap-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 border border-primary/20">
          <FileText className="h-3 w-3" />
          <span className="max-w-[140px] truncate">{currentEntryTitle || "Linked screenplay"}</span>
        </span>
        <Button
          size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => setEntry(null)}
          disabled={saving}
          title="Unlink"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
          <Link2 className="h-3 w-3" />
          Attach screenplay
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="text-xs font-medium px-1 pb-1.5 text-muted-foreground">
          Link this brief to one of your screenplays
        </div>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            No screenplays yet. Submit one first.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto space-y-0.5">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  className="w-full text-left text-sm rounded px-2 py-1.5 hover:bg-muted/60 truncate"
                  onClick={() => setEntry(e)}
                  disabled={saving}
                >
                  {e.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
