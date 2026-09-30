import { ReactNode, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth, AccessTier } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Lock, Send, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const tierLabels: Record<AccessTier, string> = {
  god_mode: "God Mode",
  dev_mode: "Dev Mode",
  administration: "Administration",
  extended: "Extended",
  limited: "Limited",
  user: "User",
};

interface AccessGateProps {
  tier: AccessTier;
  children: ReactNode;
  label?: string;
}

export function AccessGate({ tier, children, label }: AccessGateProps) {
  const { user, loading, hasAccessTier } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold mb-2">Sign In Required</h2>
          <p className="text-muted-foreground max-w-md">
            You need to sign in to access {label || "this page"}.
          </p>
        </div>
        <Link to="/auth">
          <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
            Sign In
          </Button>
        </Link>
      </div>
    );
  }

  if (!hasAccessTier(tier)) {
    return <AccessRestrictedView tier={tier} userId={user.id} />;
  }

  return <>{children}</>;
}

function AccessRestrictedView({ tier, userId }: { tier: AccessTier; userId: string }) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [existingRequest, setExistingRequest] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    supabase
      .from("access_requests")
      .select("status")
      .eq("user_id", userId)
      .eq("tier", tier)
      .eq("status", "pending")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setExistingRequest("pending");
      });
  }, [userId, tier]);

  async function handleRequest() {
    if (reason.trim().length < 5) {
      toast.error("Please provide a brief reason (at least 5 characters)");
      return;
    }
    setSending(true);
    const { error } = await supabase.from("access_requests").insert({
      user_id: userId,
      tier,
      reason: reason.trim().slice(0, 500),
    });
    if (error) {
      if (error.code === "23505") {
        toast.error("You already have a pending request for this tier");
        setExistingRequest("pending");
      } else {
        toast.error("Failed to submit request");
      }
    } else {
      toast.success("Access request submitted! An admin will review it.");
      setExistingRequest("pending");
    }
    setSending(false);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
        <Shield className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="font-display text-2xl font-bold mb-2">Access Restricted</h2>
        <p className="text-muted-foreground max-w-md">
          This page requires <span className="font-semibold text-foreground">{tierLabels[tier]}</span> access.
        </p>
      </div>

      {existingRequest === "pending" ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-primary/20 bg-primary/5">
          <CheckCircle className="h-4 w-4 text-primary" />
          <span className="text-sm text-foreground font-body">Your request is pending admin review</span>
        </div>
      ) : showForm ? (
        <div className="w-full max-w-md space-y-3">
          <Textarea
            placeholder="Why do you need access? (e.g., I'm a beta tester, I need to view leaderboard data...)"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            className="bg-muted border-border min-h-[80px] text-sm"
          />
          <p className="text-xs text-muted-foreground text-right">{reason.length}/500</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" className="font-body" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRequest}
              disabled={sending || reason.trim().length < 5}
              className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
            >
              <Send className="h-4 w-4 mr-1" />
              {sending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <Link to="/">
            <Button variant="outline" className="font-body">Back to Home</Button>
          </Link>
          <Button
            onClick={() => setShowForm(true)}
            className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
          >
            Request Access
          </Button>
        </div>
      )}
    </div>
  );
}
