export const LAUNCH_STATES = ["closed_trial", "waitlist", "open"] as const;

export type LaunchState = (typeof LAUNCH_STATES)[number];

export const DEFAULT_LAUNCH_STATE: LaunchState = "closed_trial";

export interface PublicLaunchCta {
  label: string;
  to: string;
}

export interface LaunchPresentation {
  statusLabel: string;
  statusDescription: string;
  cta: PublicLaunchCta;
}

export const LAUNCH_PRESENTATIONS = {
  closed_trial: {
    statusLabel: "CLOSED TRIAL",
    statusDescription: "Applications are open for a small group of early testers.",
    cta: { label: "Apply for Early Access", to: "/#apply" },
  },
  waitlist: {
    statusLabel: "LAUNCH WAITLIST",
    statusDescription: "Join the waitlist to hear when public access opens.",
    cta: { label: "Join the Waitlist", to: "/#waitlist" },
  },
  open: {
    statusLabel: "SUBMISSIONS OPEN",
    statusDescription: "Public screenplay submissions are open.",
    cta: { label: "Enter the Competition", to: "/submit" },
  },
} as const satisfies Record<LaunchState, LaunchPresentation>;

export function parseLaunchState(value: unknown): LaunchState {
  if (typeof value !== "string") return DEFAULT_LAUNCH_STATE;

  const normalized = value.trim().toLowerCase();
  return (LAUNCH_STATES as readonly string[]).includes(normalized)
    ? (normalized as LaunchState)
    : DEFAULT_LAUNCH_STATE;
}

export function getLaunchPresentation(state: LaunchState): LaunchPresentation {
  return LAUNCH_PRESENTATIONS[state];
}

export function getPublicLaunchAvailability(
  state: LaunchState,
  interlocks: { submissionsOpen: boolean; paymentsOpen: boolean },
): { publicSubmissionsOpen: boolean; publicPaymentsOpen: boolean } {
  const isPubliclyOpen = state === "open";

  return {
    publicSubmissionsOpen: isPubliclyOpen && interlocks.submissionsOpen,
    publicPaymentsOpen: isPubliclyOpen && interlocks.paymentsOpen,
  };
}
