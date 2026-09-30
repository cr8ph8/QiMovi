import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logAuthDecision } from "@/lib/authAudit";

export type AccessTier = "god_mode" | "dev_mode" | "administration" | "extended" | "limited" | "user";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isTester: boolean;
  isJudge: boolean;
  loading: boolean;
  accessTiers: AccessTier[];
  hasAccessTier: (tier: AccessTier) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isTester: false,
  isJudge: false,
  loading: true,
  accessTiers: [],
  hasAccessTier: () => false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTester, setIsTester] = useState(false);
  const [isJudge, setIsJudge] = useState(false);
  const [accessTiers, setAccessTiers] = useState<AccessTier[]>([]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session?.user) {
      setTimeout(() => {
          checkAdminRole(session.user.id);
          checkTesterRole(session.user.id);
          checkJudgeRole(session.user.id);
          loadAccessTiers(session.user.id);
          if (event === "SIGNED_IN") {
            logAuthDecision("sign_in", "granted", { reason: "auth state changed", details: { event } });
          }
        }, 0);
      } else {
        if (event === "SIGNED_OUT") {
          logAuthDecision("sign_out", "attempt", { reason: "auth state changed" });
        }
        setIsAdmin(false);
        setIsTester(false);
        setIsJudge(false);
        setAccessTiers([]);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        checkAdminRole(session.user.id);
        checkTesterRole(session.user.id);
        checkJudgeRole(session.user.id);
        loadAccessTiers(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkAdminRole(userId: string) {
    const { data } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    setIsAdmin(!!data);
  }

  async function checkTesterRole(userId: string) {
    const { data } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "tester",
    });
    setIsTester(!!data);
  }

  async function checkJudgeRole(userId: string) {
    const { data } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "judge",
    });
    setIsJudge(!!data);
  }

  async function loadAccessTiers(userId: string) {
    const { data } = await supabase
      .from("access_grants")
      .select("tier")
      .eq("user_id", userId);
    if (data) {
      setAccessTiers(data.map(d => d.tier as AccessTier));
    }
  }

  function hasAccessTier(tier: AccessTier): boolean {
    if (isAdmin) return true;
    const rank: Record<AccessTier, number> = {
      user: 0,
      limited: 1,
      extended: 2,
      administration: 3,
      dev_mode: 4,
      god_mode: 5,
    };
    const required = rank[tier] ?? 0;
    const granted = accessTiers.some((t) => (rank[t] ?? 0) >= required);
    if (!granted) {
      // Log denials only (avoid flooding on every render)
      logAuthDecision("tier_check", "denied", {
        resource: tier,
        details: { required_rank: required, user_tiers: accessTiers },
      });
    }
    return granted;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      isAdmin,
      isTester,
      isJudge,
      loading,
      accessTiers,
      hasAccessTier,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
