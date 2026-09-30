import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { logAuthDecision } from "@/lib/authAudit";
import { logAccessDenial } from "@/lib/logAccessDenial";
import { saveAccessIntent } from "@/lib/accessIntent";
import Unauthorized from "@/pages/Unauthorized";

/**
 * Allows signed-in users into writer/entrant surfaces.
 *
 * Normal screenplay owners are not guaranteed to have a row in public.user_roles;
 * that table is reserved for elevated roles like admin, judge, tester, etc. The
 * actual per-entry ownership check happens in RLS and in the entry workspace
 * query, so this guard must only require a valid session and must not block a
 * writer because they lack an elevated role row.
 *
 * On denial, captures an access intent (path + query + hash) so `Auth.tsx`
 * sends the user straight back to where they were after signing in.
 */
export function EntrantRouteGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    if (!user) {
      setAllowed(false);
      saveAccessIntent({ returnTo, reason: "entrant_route:not signed in" });
      logAuthDecision("entrant_route", "denied", {
        resource: location.pathname,
        reason: "not signed in",
      });
      logAccessDenial("entrant_route", {
        resource: location.pathname,
        reason: "not signed in",
      });
      return;
    }
    if (cancelled) return;
    setAllowed(true);
    logAuthDecision("entrant_route", "granted", {
      resource: location.pathname,
      reason: "signed in",
      details: { user_id: user.id },
    });
    return () => {
      cancelled = true;
    };
  }, [user, loading, location.pathname, location.search, location.hash]);

  if (loading || allowed === null) return null;
  if (!user) return <Unauthorized />;
  if (!allowed) return <Unauthorized />;
  return <>{children}</>;
}

