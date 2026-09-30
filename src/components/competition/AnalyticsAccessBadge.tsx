// In-UI badge + protected-action helpers indicating what the current viewer
// can access on competition analytics surfaces (judge performance, scoring
// analytics, exports). When the viewer lacks access, protected actions render
// as disabled with a clear upgrade/permission prompt + link to sign in.

import { ReactNode, useCallback, useEffect } from "react";
import { Shield, User, Gavel, Eye, Check, X, Lock, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCompetitionAnalyticsAccess } from "@/lib/competition/analyticsAccess";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logAuthDecision } from "@/lib/authAudit";
import { useAccessGate } from "./AccessGateModal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type AnalyticsRole = "operator" | "judge" | "entrant" | "viewer";

const ROLE_META: Record<AnalyticsRole, { label: string; tone: string; icon: typeof Shield; blurb: string }> = {
  operator: {
    label: "Operator",
    tone: "bg-destructive/10 text-destructive border-destructive/20",
    icon: Shield,
    blurb: "Full operator access — judge performance, analytics, and exports.",
  },
  judge: {
    label: "Judge",
    tone: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: Gavel,
    blurb: "Judging access — review judge data, analytics, and exports.",
  },
  entrant: {
    label: "Entrant",
    tone: "bg-primary/10 text-primary border-primary/20",
    icon: User,
    blurb: "Entrant access — analytics and exports for competitions you participate in.",
  },
  viewer: {
    label: "Viewer",
    tone: "bg-muted/30 text-muted-foreground border-border/40",
    icon: Eye,
    blurb: "Public viewer — sign in to unlock judge data, analytics, and exports.",
  },
};

export interface AnalyticsAccessState {
  role: AnalyticsRole;
  canSeeJudgeData: boolean;
  canSeeAnalytics: boolean;
  canExportAnalytics: boolean;
  /** A short, user-facing reason the viewer is gated (empty if no gate). */
  gateMessage: string;
  /** Where to send the viewer to upgrade their access. */
  upgradeHref: string;
  /** Whether the viewer should sign in (vs. already authed but unprivileged). */
  needsSignIn: boolean;
}

export function useAnalyticsAccessState(): AnalyticsAccessState {
  const { user, isAdmin, isTester } = useAuth();
  const { canSeeAnalytics, canExportAnalytics } = useCompetitionAnalyticsAccess();

  const role: AnalyticsRole = isAdmin
    ? "operator"
    : isTester
      ? "judge"
      : user
        ? "entrant"
        : "viewer";

  const canSeeJudgeData = role !== "viewer";
  const needsSignIn = !user;

  let gateMessage = "";
  if (!canSeeAnalytics) gateMessage = "Sign in as an entrant, judge, or operator to view analytics.";
  else if (!canExportAnalytics) gateMessage = "Your role doesn't allow analytics exports.";

  return {
    role,
    canSeeJudgeData,
    canSeeAnalytics,
    canExportAnalytics,
    gateMessage,
    upgradeHref: needsSignIn ? "/auth" : "/pricing",
    needsSignIn,
  };
}

interface BadgeProps {
  /** Show capability checklist inline (default true). */
  showCapabilities?: boolean;
  className?: string;
}

export function AnalyticsAccessBadge({ showCapabilities = true, className }: BadgeProps) {
  const { role, canSeeJudgeData, canSeeAnalytics, canExportAnalytics, gateMessage } = useAnalyticsAccessState();
  const { openGate } = useAccessGate();
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  const isLocked = !canSeeAnalytics || !canExportAnalytics || !canSeeJudgeData;

  const caps = [
    { label: "Judge data", on: canSeeJudgeData },
    { label: "Analytics", on: canSeeAnalytics },
    { label: "Export", on: canExportAnalytics },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role={isLocked ? "button" : undefined}
            tabIndex={isLocked ? 0 : undefined}
            onClick={isLocked ? () => openGate({ actionId: "badge_click", surface: "AnalyticsAccessBadge", reason: gateMessage }) : undefined}
            onKeyDown={isLocked ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGate({ actionId: "badge_keydown", surface: "AnalyticsAccessBadge", reason: gateMessage }); } } : undefined}
            className={cn(
              "inline-flex items-center gap-2 px-2 py-1 rounded-full border text-[10px] font-mono uppercase tracking-wider",
              meta.tone,
              isLocked && "cursor-pointer hover:brightness-110",
              className,
            )}
          >
            <Icon className="w-3 h-3" />
            {meta.label}
            {showCapabilities && (
              <span className="flex items-center gap-1.5 pl-1.5 ml-0.5 border-l border-current/20">
                {caps.map((c) => (
                  <span
                    key={c.label}
                    className={cn(
                      "inline-flex items-center gap-0.5 normal-case tracking-normal",
                      c.on ? "opacity-100" : "opacity-50 line-through",
                    )}
                  >
                    {c.on ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                    {c.label}
                  </span>
                ))}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
          <p className="font-semibold">{meta.label}</p>
          <p className="text-muted-foreground">{meta.blurb}</p>
          {isLocked && (
            <p className="text-[10px] text-primary uppercase tracking-wider pt-1">Click to see next steps</p>
          )}
          <ul className="space-y-0.5 pt-1">
            {caps.map((c) => (
              <li key={c.label} className="flex items-center gap-1.5">
                {c.on ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <X className="w-3 h-3 text-muted-foreground" />
                )}
                <span className={c.on ? "" : "text-muted-foreground line-through"}>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface LockedActionButtonProps extends Omit<ButtonProps, "asChild"> {
  /** Whether the viewer is allowed to perform the action. */
  allowed: boolean;
  /** Optional override of the locked-state hint. */
  lockedHint?: string;
  /** Stable identifier for analytics (e.g. "export_batch_csv"). */
  actionId?: string;
  /** Surface name for analytics (e.g. "BatchResultsSummary"). */
  surface?: string;
  children: ReactNode;
}

/**
 * Drop-in replacement for a protected <Button>. When `allowed` is false the
 * button is disabled, an explanatory tooltip shows the gate reason, and a
 * small inline "Sign in" / "Upgrade" link appears next to it. Lock impressions
 * and click-throughs on the prompt are recorded via logAuthDecision so the
 * conversion of locked prompts → sign-ins / upgrades can be analysed.
 */
export function LockedActionButton({
  allowed,
  lockedHint,
  actionId,
  surface,
  children,
  className,
  ...buttonProps
}: LockedActionButtonProps) {
  const { gateMessage, upgradeHref, needsSignIn, role } = useAnalyticsAccessState();
  const { openGate } = useAccessGate();

  const logEvent = useCallback(
    (decision: "denied" | "attempt", extra: Record<string, unknown> = {}) => {
      logAuthDecision("locked_action", decision, {
        resource: actionId || (typeof children === "string" ? children : "locked_action"),
        reason: gateMessage || lockedHint || "viewer lacks access",
        details: {
          surface: surface ?? null,
          role,
          prompt: needsSignIn ? "sign_in" : "upgrade",
          upgrade_href: upgradeHref,
          ...extra,
        },
      });
    },
    [actionId, children, gateMessage, lockedHint, surface, role, needsSignIn, upgradeHref],
  );

  if (allowed) {
    return (
      <Button className={className} {...buttonProps}>
        {children}
      </Button>
    );
  }

  const hint = lockedHint || gateMessage || "You don't have permission for this action.";

  const triggerGate = () => {
    logEvent("attempt", { event: "cta_clicked", cta: needsSignIn ? "sign_in" : "upgrade" });
    openGate({ actionId, surface, reason: hint });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip onOpenChange={(open) => { if (open) logEvent("denied", { event: "prompt_shown" }); }}>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-2">
            <Button
              {...buttonProps}
              disabled
              onClick={(e) => { e.preventDefault(); logEvent("denied", { event: "disabled_button_click" }); triggerGate(); }}
              className={cn(className, "opacity-60 cursor-not-allowed pointer-events-auto")}
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              {children}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={triggerGate}
              className="h-7 px-2 text-[11px] font-mono uppercase tracking-wider text-primary hover:text-primary"
            >
              <LogIn className="h-3 w-3 mr-1" />
              {needsSignIn ? "Sign in" : "Upgrade"}
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface PermissionPromptProps {
  /** Heading for the locked section. */
  title?: string;
  /** Sub-message shown beneath the title. */
  description?: string;
  /** Stable identifier for analytics (e.g. "scoring_weights"). */
  actionId?: string;
  /** Surface name for analytics (e.g. "FestivalProfile"). */
  surface?: string;
  className?: string;
}

/**
 * Card-style placeholder used in place of a gated analytics section. Shows
 * what's locked and a clear sign-in / upgrade call to action. An impression
 * event is recorded the first time it mounts; the CTA click is tracked too.
 */
export function PermissionPrompt({
  title = "Locked analytics",
  description,
  actionId,
  surface,
  className,
}: PermissionPromptProps) {
  const { gateMessage, upgradeHref, needsSignIn, role } = useAnalyticsAccessState();
  const { openGate } = useAccessGate();
  const body = description || gateMessage || "Sign in with the right role to view this section.";

  const logEvent = useCallback(
    (decision: "denied" | "attempt", extra: Record<string, unknown> = {}) => {
      logAuthDecision("locked_section", decision, {
        resource: actionId || title,
        reason: gateMessage || "viewer lacks access",
        details: {
          surface: surface ?? null,
          role,
          prompt: needsSignIn ? "sign_in" : "upgrade",
          upgrade_href: upgradeHref,
          ...extra,
        },
      });
    },
    [actionId, title, gateMessage, surface, role, needsSignIn, upgradeHref],
  );

  // Fire impression once per mount.
  useEffect(() => {
    logEvent("denied", { event: "prompt_shown" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center space-y-3",
        className,
      )}
    >
      <div className="mx-auto w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center">
        <Lock className="w-4 h-4 text-muted-foreground" />
      </div>
      <div>
        <h4 className="font-display text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{body}</p>
      </div>
      <div className="flex items-center justify-center gap-2 pt-1">
        <AnalyticsAccessBadge showCapabilities={false} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            logEvent("attempt", { event: "cta_clicked", cta: needsSignIn ? "sign_in" : "upgrade" });
            openGate({ actionId, surface, reason: body });
          }}
        >
          <LogIn className="h-3.5 w-3.5 mr-1.5" />
          {needsSignIn ? "Sign in to unlock" : role === "entrant" ? "Upgrade access" : "Request access"}
        </Button>
      </div>
    </div>
  );
}

