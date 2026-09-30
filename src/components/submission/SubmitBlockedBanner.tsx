import { AlertTriangle, Coins, Lock, CalendarX, FileWarning, LogIn, ShieldOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { SubmitBlockedReason } from "@/lib/logSubmitBlocked";

/**
 * User-facing banner for a blocked submission.
 *
 * Every visible reason a user cannot submit is centralised here and
 * keyed off the SAME `SubmitBlockedReason` code that
 * `src/lib/logSubmitBlocked.ts` emits to analytics. That guarantees
 * three things:
 *
 *   1. What the user sees and what the dashboard buckets on are the
 *      same string — no drift.
 *   2. Adding a new blocked reason means: extend `SubmitBlockedReason`,
 *      add a case in `REASON_COPY` below, and (optionally) log it.
 *      A missing case falls through to a safe generic message so we
 *      never crash on an unknown code.
 *   3. Copy, icon, and CTA are consistent regardless of whether the
 *      block is a full-page gate (SubmissionsClosedGate) or an inline
 *      warning above the submit button.
 */

export interface SubmitBlockedBannerContext {
  /** Human-readable competition label, e.g. "Season Zero — Short Film". */
  competition_label?: string | null;
  /** Length-category label for inline copy, e.g. "Short Film". */
  category_label?: string | null;
  /** Fee (in tokens) for the target category. Used by insufficient_tokens. */
  required_tokens?: number | null;
  /** Current wallet balance. Used by insufficient_tokens. */
  current_balance?: number | null;
  /** Deadline ISO string. Used by category_deadline_passed. */
  deadline?: string | null;
  /** Actual page count. Used by ineligible_page_count. */
  page_count?: number | null;
  /** Free-form additional detail (e.g. eligibility trigger reason). */
  detail?: string | null;
}

interface CopySpec {
  icon: ReactNode;
  title: string;
  body: (ctx: SubmitBlockedBannerContext) => ReactNode;
  cta?: (ctx: SubmitBlockedBannerContext) => ReactNode;
  /** Alert variant. `destructive` for user-blocking, otherwise default. */
  variant?: "default" | "destructive";
}

const REASON_COPY: Record<SubmitBlockedReason, CopySpec> = {
  submissions_closed: {
    icon: <Lock className="h-4 w-4" />,
    title: "Submissions are closed",
    body: () => (
      <>
        We're not accepting new submissions right now. Join the waitlist
        on the homepage to be notified the moment submissions reopen.
      </>
    ),
    cta: () => (
      <Link to="/">
        <Button size="sm" variant="outline" className="font-body">
          Back to home
        </Button>
      </Link>
    ),
  },
  payments_closed: {
    icon: <Lock className="h-4 w-4" />,
    title: "Payments are temporarily disabled",
    body: () => (
      <>
        Entry fees can't be charged at the moment, so new submissions
        are on hold. Please check back shortly.
      </>
    ),
  },
  signups_closed: {
    icon: <Lock className="h-4 w-4" />,
    title: "New sign-ups are paused",
    body: () => (
      <>
        Account creation is currently closed. Existing accounts can
        still sign in, but new submissions require an account.
      </>
    ),
  },
  category_deadline_passed: {
    icon: <CalendarX className="h-4 w-4" />,
    title: "This category's deadline has passed",
    body: (ctx) => (
      <>
        {ctx.category_label ?? "This category"} closed
        {ctx.deadline ? ` on ${formatDeadline(ctx.deadline)}` : ""}.
        Pick another open category, or watch for the next season.
      </>
    ),
  },
  ineligible_page_count: {
    icon: <FileWarning className="h-4 w-4" />,
    title: "Page count doesn't match this category",
    body: (ctx) => (
      <>
        {ctx.detail ??
          `Your script (${ctx.page_count ?? "?"} pages) doesn't fit ${ctx.category_label ?? "the selected category"}. Try a category whose page range matches.`}
      </>
    ),
  },
  insufficient_tokens: {
    icon: <Coins className="h-4 w-4" />,
    title: "Not enough tokens to enter",
    body: (ctx) => {
      const need = ctx.required_tokens ?? 0;
      const have = ctx.current_balance ?? 0;
      const short = Math.max(0, need - have);
      return (
        <>
          {ctx.category_label ?? "This category"} costs{" "}
          <span className="font-mono font-semibold">{need}</span> tokens.
          Your balance is <span className="font-mono font-semibold">{have}</span> —{" "}
          you need <span className="font-mono font-semibold">{short}</span> more
          to submit.
        </>
      );
    },
    cta: () => (
      <Link to="/pricing">
        <Button size="sm" variant="outline" className="font-body">
          Top up tokens
        </Button>
      </Link>
    ),
  },
  unauthenticated: {
    icon: <LogIn className="h-4 w-4" />,
    title: "Sign in to submit",
    body: () => (
      <>
        You need to be signed in to enter a competition. Sign in with
        your existing account, or create one to get started.
      </>
    ),
    cta: () => (
      <Link to="/auth">
        <Button size="sm" variant="outline" className="font-body">
          Sign in
        </Button>
      </Link>
    ),
  },
};

function formatDeadline(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export interface SubmitBlockedBannerProps {
  /** MUST be the same code passed to `logSubmitBlocked`. */
  reason: SubmitBlockedReason;
  context?: SubmitBlockedBannerContext;
  /** Layout mode. `inline` = compact banner; `page` = larger hero copy. */
  variant?: "inline" | "page";
  className?: string;
}

export default function SubmitBlockedBanner({
  reason,
  context = {},
  variant = "inline",
  className,
}: SubmitBlockedBannerProps) {
  const spec: CopySpec = REASON_COPY[reason] ?? {
    icon: <ShieldOff className="h-4 w-4" />,
    title: "Submission blocked",
    body: () => (
      <>This submission can't proceed right now. Please try again later.</>
    ),
    variant: "destructive",
  };


  return (
    <Alert
      variant={spec.variant ?? "destructive"}
      className={className}
      role="status"
      // Machine-readable hook so specs + downstream automation can
      // assert on the banner's reason without relying on copy.
      data-blocked-reason={reason}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-current" aria-hidden="true">
          {spec.icon}
        </div>
        <div className="flex-1 space-y-1">
          <AlertTitle className={variant === "page" ? "text-lg" : undefined}>
            {spec.title}
          </AlertTitle>
          <AlertDescription className="text-sm leading-relaxed">
            {spec.body(context)}
          </AlertDescription>
          {spec.cta && (
            <div className="pt-2">{spec.cta(context)}</div>
          )}
        </div>
      </div>
      {/* Icon-only fallback for screen readers announcing an alert */}
      <AlertTriangle className="sr-only" />
    </Alert>
  );
}
