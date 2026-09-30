// Centralized Upgrade / Sign-in modal opened by the AnalyticsAccessBadge,
// LockedActionButton, and PermissionPrompt. Provides clear, role-aware next
// steps for viewers, entrants, judges, and operators.

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Lock, LogIn, Sparkles, Gavel, Shield, User, ArrowRight, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAnalyticsAccessState, type AnalyticsRole } from "./AnalyticsAccessBadge";
import { logAuthDecision } from "@/lib/authAudit";
import { saveAccessIntent, withRedirect } from "@/lib/accessIntent";

export interface OpenGateOptions {
  /** Stable action id e.g. "export_batch_csv" (for telemetry). */
  actionId?: string;
  /** Surface where the gate was triggered. */
  surface?: string;
  /** Short reason shown in the modal subtitle. */
  reason?: string;
}

interface GateContextValue {
  openGate: (opts?: OpenGateOptions) => void;
}

const GateContext = createContext<GateContextValue | null>(null);

export function useAccessGate(): GateContextValue {
  const ctx = useContext(GateContext);
  if (!ctx) {
    // Safe no-op fallback so components used outside the provider don't crash.
    return { openGate: () => {} };
  }
  return ctx;
}

interface RoleCopy {
  icon: typeof Shield;
  title: string;
  description: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  steps: string[];
}

function copyForRole(role: AnalyticsRole, reason?: string): RoleCopy {
  switch (role) {
    case "viewer":
      return {
        icon: User,
        title: "Sign in to unlock analytics",
        description: reason || "Judge data, scoring distributions, and exports are reserved for entrants, judges, and operators.",
        primaryLabel: "Sign in",
        primaryHref: "/auth",
        secondaryLabel: "Create an account",
        secondaryHref: "/auth?mode=signup",
        steps: [
          "Sign in or create a free account.",
          "Enter a competition or accept a judge invite to see analytics.",
          "Operators unlock exports and judge performance views automatically.",
        ],
      };
    case "entrant":
      return {
        icon: Sparkles,
        title: "Upgrade to view full analytics",
        description: reason || "Your entrant role lets you see your own results. Deeper judge performance and exports are gated by plan or operator role.",
        primaryLabel: "See plans",
        primaryHref: "/pricing",
        secondaryLabel: "Contact the operator",
        secondaryHref: "mailto:support@caniscreenwrite.com?subject=Analytics%20access",
        steps: [
          "Upgrade your plan to unlock exports and advanced analytics.",
          "Or request judge / operator access from the competition organizer.",
          "You'll keep access to your own scorecards either way.",
        ],
      };
    case "judge":
      return {
        icon: Gavel,
        title: "You're signed in as a judge",
        description: reason || "Judge accounts can view analytics for competitions they're assigned to. Some exports are restricted to operators.",
        primaryLabel: "Open judge dashboard",
        primaryHref: "/judging",
        secondaryLabel: "Request operator access",
        secondaryHref: "mailto:support@caniscreenwrite.com?subject=Operator%20access",
        steps: [
          "Make sure you're assigned to this competition.",
          "Operator-only exports require elevated permissions.",
          "Contact the competition operator if you need them.",
        ],
      };
    case "operator":
    default:
      return {
        icon: Shield,
        title: "Operator access active",
        description: reason || "If something looks locked, your session may need to refresh.",
        primaryLabel: "Reload page",
        primaryHref: "#reload",
        steps: [
          "Operators have full analytics and export access.",
          "Try reloading if a locked state appears unexpectedly.",
          "Contact engineering if the issue persists.",
        ],
      };
  }
}

export function AccessGateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<OpenGateOptions | undefined>(undefined);
  const [returnTo, setReturnTo] = useState<string>("/");
  const state = useAnalyticsAccessState();
  const location = useLocation();

  const openGate = useCallback((next?: OpenGateOptions) => {
    const path = `${location.pathname}${location.search}${location.hash}`;
    setOpts(next);
    setReturnTo(path);
    setOpen(true);
    saveAccessIntent({
      returnTo: path,
      actionId: next?.actionId,
      reason: next?.reason || state.gateMessage,
    });
    logAuthDecision("access_gate_modal", "denied", {
      resource: next?.actionId || "access_gate",
      reason: next?.reason || state.gateMessage || "viewer lacks access",
      details: {
        surface: next?.surface ?? null,
        role: state.role,
        prompt: state.needsSignIn ? "sign_in" : "upgrade",
        return_to: path,
        event: "modal_opened",
      },
    });
  }, [location.pathname, location.search, location.hash, state.gateMessage, state.needsSignIn, state.role]);

  const value = useMemo(() => ({ openGate }), [openGate]);
  const copy = copyForRole(state.role, opts?.reason);
  const Icon = copy.icon;
  const primaryHref = copy.primaryHref.startsWith("/") ? withRedirect(copy.primaryHref, returnTo) : copy.primaryHref;
  const secondaryHref = copy.secondaryHref && copy.secondaryHref.startsWith("/")
    ? withRedirect(copy.secondaryHref, returnTo)
    : copy.secondaryHref;

  const handlePrimary = () => {
    logAuthDecision("access_gate_modal", "attempt", {
      resource: opts?.actionId || "access_gate",
      reason: opts?.reason || state.gateMessage,
      details: {
        surface: opts?.surface ?? null,
        role: state.role,
        event: "cta_clicked",
        cta: "primary",
        href: copy.primaryHref,
      },
    });
    if (copy.primaryHref === "#reload") {
      window.location.reload();
    }
    setOpen(false);
  };

  const handleSecondary = () => {
    logAuthDecision("access_gate_modal", "attempt", {
      resource: opts?.actionId || "access_gate",
      reason: opts?.reason || state.gateMessage,
      details: {
        surface: opts?.surface ?? null,
        role: state.role,
        event: "cta_clicked",
        cta: "secondary",
        href: copy.secondaryHref ?? null,
      },
    });
    setOpen(false);
  };

  return (
    <GateContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <DialogTitle className="font-display text-lg">{copy.title}</DialogTitle>
                <DialogDescription className="text-xs mt-1">
                  Current role: <span className="uppercase tracking-wider font-mono">{state.role}</span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">{copy.description}</p>

          <ol className="space-y-2 text-sm">
            {copy.steps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground text-[11px] font-mono flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-foreground/90">{step}</span>
              </li>
            ))}
          </ol>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            {copy.secondaryLabel && secondaryHref && (
              secondaryHref.startsWith("mailto:") ? (
                <Button asChild variant="ghost" size="sm" onClick={handleSecondary}>
                  <a href={secondaryHref}>
                    <Mail className="w-3.5 h-3.5 mr-1.5" />
                    {copy.secondaryLabel}
                  </a>
                </Button>
              ) : (
                <Button asChild variant="ghost" size="sm" onClick={handleSecondary}>
                  <Link to={secondaryHref}>{copy.secondaryLabel}</Link>
                </Button>
              )
            )}
            {copy.primaryHref === "#reload" ? (
              <Button onClick={handlePrimary} size="sm">
                {copy.primaryLabel}
              </Button>
            ) : (
              <Button asChild size="sm" onClick={handlePrimary}>
                <Link to={primaryHref}>
                  {state.needsSignIn ? <LogIn className="w-3.5 h-3.5 mr-1.5" /> : <Lock className="w-3.5 h-3.5 mr-1.5" />}
                  {copy.primaryLabel}
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GateContext.Provider>
  );
}
