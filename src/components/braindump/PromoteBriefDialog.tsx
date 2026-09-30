/**
 * PromoteBriefDialog
 *
 * Modal launcher around the shared `usePromoteBrief` controller. The
 * controller is now created in the parent page so the same live state
 * also powers the inline Brain Dump timeline — closing the dialog no
 * longer hides progress.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromoteTimeline } from "@/components/braindump/PromoteTimeline";
import { PromoteStepDetailsDrawer } from "@/components/braindump/PromoteStepDetailsDrawer";
import type { usePromoteBrief, PromoteStepId } from "@/hooks/usePromoteBrief";
import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";

type Controller = ReturnType<typeof usePromoteBrief>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: Controller;
  brief: OrganizedBrief | null;
  briefId: string | null;
  briefTitle: string | null;
  userId: string | null;
  authorName?: string | null;
  genre?: string | null;
}

export function PromoteBriefDialog({
  open,
  onOpenChange,
  controller,
  brief,
  briefId,
  briefTitle,
  userId,
  authorName,
  genre,
}: Props) {
  const navigate = useNavigate();
  const { states, errorMessage, running, resultDraftId, allDone, logs, run, reset } = controller;
  const [openStep, setOpenStep] = useState<PromoteStepId | null>(null);

  const logCounts = useMemo(() => {
    const out: Partial<Record<PromoteStepId, number>> = {};
    (Object.keys(logs) as PromoteStepId[]).forEach((k) => { out[k] = logs[k].length; });
    return out;
  }, [logs]);

  // Reset only when re-opening AFTER a finished/error run, so users who
  // close the dialog mid-flight can re-open it and still see live state.
  useEffect(() => {
    if (open && !running && (allDone || errorMessage)) {
      // leave it alone — show the final result
    } else if (open && !running && !resultDraftId && !errorMessage) {
      reset();
    }
  }, [open, running, allDone, errorMessage, resultDraftId, reset]);

  const canRetry = !running && errorMessage !== null;
  const canStart = !running && !allDone && errorMessage === null;

  function handleRun() {
    run({ brief, briefId, briefTitle, userId, authorName, genre });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Promote brief to draft
          </DialogTitle>
          <DialogDescription>
            Builds a Fountain scaffold from this brief — Title Page, premise, characters,
            outline beats and a starter scene — then opens it in the unified workspace.
            Tap any step for live logs and generated artifacts.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <PromoteTimeline
            states={states}
            onSelectStep={setOpenStep}
            selectedStep={openStep}
            badgeCounts={logCounts}
          />
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
            {allDone ? "Close" : running ? "Hide (keeps running)" : "Cancel"}
          </Button>
          {resultDraftId && !running && (
            <Button variant="outline" onClick={() => navigate(`/entry/${resultDraftId}#write`)}>
              Open draft <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {(canStart || canRetry) && (
            <Button onClick={handleRun} disabled={!brief || !briefId || !userId}>
              {canRetry ? "Retry" : "Promote to Draft"}
            </Button>
          )}
        </DialogFooter>
        <PromoteStepDetailsDrawer
          controller={controller}
          stepId={openStep}
          onOpenChange={(o) => { if (!o) setOpenStep(null); }}
        />
      </DialogContent>
    </Dialog>
  );
}
