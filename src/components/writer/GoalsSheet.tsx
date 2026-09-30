import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  draftId: string | null;
  dailyGoal: number;
  targetPages: number | null;
  onUpdated: (next: { dailyGoal?: number; targetPages?: number | null }) => void;
  userId: string | null | undefined;
}

export function GoalsSheet({ draftId, dailyGoal, targetPages, onUpdated, userId }: Props) {
  const [open, setOpen] = useState(false);
  const [daily, setDaily] = useState(String(dailyGoal));
  const [pages, setPages] = useState(targetPages ? String(targetPages) : "");

  const save = async () => {
    if (!userId) return;
    const dailyN = Math.max(0, parseInt(daily, 10) || 0);
    const pagesN = pages ? Math.max(1, parseInt(pages, 10) || 0) : null;

    await supabase.from("writing_goals").upsert(
      { user_id: userId, daily_word_goal: dailyN } as never,
      { onConflict: "user_id" } as never,
    );
    if (draftId) {
      await supabase.from("screenplay_drafts").update({ target_page_count: pagesN }).eq("id", draftId);
    }
    onUpdated({ dailyGoal: dailyN, targetPages: pagesN });
    toast.success("Writing goals updated");
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Writing goals">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Writing goals</SheetTitle>
          <SheetDescription>
            Set how much you want to write each day and how long this screenplay should be.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="daily-goal">Daily word goal</Label>
            <Input
              id="daily-goal"
              type="number"
              min={0}
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Used for the daily ring and streak tracking.</p>
          </div>
          {draftId && (
            <div className="space-y-2">
              <Label htmlFor="target-pages">Target page count for this script</Label>
              <Input
                id="target-pages"
                type="number"
                min={1}
                placeholder="Use format default"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Drives completion % and structural milestones. Leave blank to use the format default.
              </p>
            </div>
          )}
          <Button onClick={save} className="w-full">Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
