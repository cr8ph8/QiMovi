import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAuthDecision } from "@/lib/authAudit";
import { logAccessDenial } from "@/lib/logAccessDenial";
import Unauthorized from "@/pages/Unauthorized";

/**
 * Wraps an admin-only route. Until role status is known, renders nothing
 * (avoids leaking the lazy-loaded page bundle to non-admins via flash).
 * Redirects to /auth if signed out, / if signed in without admin role.
 */
export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    if (!user) {
      setIsAdmin(false);
      logAuthDecision("admin_route", "denied", { resource: location.pathname, reason: "not signed in" });
      logAccessDenial("admin_route", { resource: location.pathname, reason: "not signed in" });
      return;
    }
    (async () => {
      const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!cancelled) {
        const ok = Boolean(data);
        setIsAdmin(ok);
        logAuthDecision("admin_route", ok ? "granted" : "denied", {
          resource: location.pathname,
          reason: ok ? "admin role" : "not admin",
        });
        if (!ok) {
          logAccessDenial("admin_route", {
            resource: location.pathname,
            reason: "not admin",
            details: { user_id: user.id },
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading, location.pathname]);

  if (loading || isAdmin === null) return null;
  if (!user) return <Unauthorized />;
  if (!isAdmin) return <Unauthorized />;
  return <>{children}</>;
}

