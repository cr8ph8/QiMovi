import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAuthDecision } from "@/lib/authAudit";
import { logAccessDenial } from "@/lib/logAccessDenial";
import Unauthorized from "@/pages/Unauthorized";

/**
 * Allows admins OR judges into the route. Renders nothing until role status
 * is resolved (avoids leaking the lazy-loaded bundle on flash). Signed-out
 * users go to /auth; signed-in users without the right role go to /.
 */
export function JudgeRouteGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    if (!user) {
      setAllowed(false);
      logAuthDecision("judge_route", "denied", { resource: location.pathname, reason: "not signed in" });
      logAccessDenial("judge_route", { resource: location.pathname, reason: "not signed in" });
      return;
    }
    (async () => {
      const [{ data: isAdmin }, { data: isJudge }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "judge" }),
      ]);
      if (!cancelled) {
        const ok = Boolean(isAdmin) || Boolean(isJudge);
        setAllowed(ok);
        logAuthDecision("judge_route", ok ? "granted" : "denied", {
          resource: location.pathname,
          reason: ok ? (isAdmin ? "admin role" : "judge role") : "no operator/judge role",
        });
        if (!ok) {
          logAccessDenial("judge_route", {
            resource: location.pathname,
            reason: "no operator/judge role",
            details: { user_id: user.id },
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading, location.pathname]);

  if (loading || allowed === null) return null;
  if (!user) return <Unauthorized />;
  if (!allowed) return <Unauthorized />;
  return <>{children}</>;
}
