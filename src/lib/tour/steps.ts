import type { DriveStep } from "driver.js";

export type TourTrack = "writer" | "judge";

export interface QiTourStep extends DriveStep {
  /** Optional route to navigate to before showing this step. */
  route?: string;
  /** If set and the element does not exist after navigation, the step is skipped. */
  optional?: boolean;
}

const popover = (title: string, description: string, side: "top" | "bottom" | "left" | "right" = "bottom") => ({
  title,
  description,
  side,
  align: "center" as const,
  popoverClass: "qi-tour",
});

/** Shown to every signed-in user before their role-specific track. */
export const sharedSteps: QiTourStep[] = [
  {
    popover: popover(
      "Welcome to CanIScreenwrite",
      "A quick 60-second tour to show you how to submit, analyze, and compete with your screenplays. You can skip anytime.",
      "bottom",
    ),
  },
  {
    element: '[data-tour="wallet"]',
    popover: popover(
      "Your token wallet",
      "Tokens power every AI action — analysis, rewrites, scorecards, and competition entries. 1 token = 1¢.",
      "bottom",
    ),
    optional: true,
  },
  {
    element: '[data-tour="help"]',
    popover: popover(
      "Re-open this tour anytime",
      "Click the Help button up here to restart this walkthrough whenever you need it.",
      "bottom",
    ),
    optional: true,
  },
];

export const writerSteps: QiTourStep[] = [
  {
    element: '[data-tour="write-menu"]',
    popover: popover(
      "Start writing",
      "Open the Write menu to capture an idea in Brain Dump, start a blank script, or resume your latest draft.",
      "bottom",
    ),
    optional: true,
  },
  {
    element: '[data-tour="submit-cta"]',
    popover: popover(
      "Submit a screenplay",
      "When your script is ready, hit Enter Now to send it to a competition or your private Qi-List portfolio.",
      "bottom",
    ),
    optional: true,
    route: "/",
  },
  {
    popover: popover(
      "Your workspace",
      "Each submission opens a workspace with tabs for Analysis, Rewrites, Reports, and Sharing — all powered by AI but driven by you.",
      "bottom",
    ),
  },
  {
    popover: popover(
      "Compete and improve",
      "Browse the Leaderboard to see top-scoring scripts, then iterate with guided rewrites to climb the ranks. That's it — happy writing!",
      "bottom",
    ),
  },
];

export const judgeSteps: QiTourStep[] = [
  {
    popover: popover(
      "Welcome, Judge",
      "Here is how the judging console works: review imported entries, score rubrics with the panel, and let the lead judge finalize.",
      "bottom",
    ),
    route: "/judges",
  },
  {
    popover: popover(
      "Open an entry's scorecard",
      "Click any imported entry to open its scorecard. You'll see rubric sliders for each dimension plus a Panel tab with everyone's drafts side-by-side.",
      "bottom",
    ),
  },
  {
    popover: popover(
      "Discuss before finalizing",
      "Leave per-dimension comments in the Panel tab. All threads must be resolved before the lead judge can finalize the median score.",
      "bottom",
    ),
  },
  {
    popover: popover(
      "Blocking threads drawer",
      "If finalize is gated, open the Blocking Threads drawer to jump straight to every unresolved comment. Resolve them, then finalize.",
      "bottom",
    ),
  },
];
