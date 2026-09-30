import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useLoginRateLimit } from "@/hooks/useLoginRateLimit";
import { resolveRedirectPath, clearAccessIntent } from "@/lib/accessIntent";

function DemoRequestForm() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase
      .from("closed_trial_applications" as any)
      .insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        reason: reason.trim(),
        role: "demo_requester",
        origin: "demo_form",
      } as any);
    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already applied!", description: "We already have your application on file." });
        setDone(true);
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    } else {
      setDone(true);
      toast({ title: "Application received!", description: "We'll review your application and reach out soon." });
      supabase.functions.invoke("notify-trial-application", {
        body: { name: name.trim(), email: email.trim().toLowerCase(), role: "demo_requester" },
      });
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
      <p className="font-display text-lg font-bold mb-1">Application Received ✓</p>
        <p className="text-sm text-muted-foreground">We'll review your early access application and reach out soon.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-6 mt-6">
      <h3 className="font-display text-base font-bold mb-1">Apply for Early Access</h3>
      <p className="text-xs text-muted-foreground mb-4">Want to try the platform? Tell us a bit about yourself.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label className="font-body text-sm">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1 bg-muted border-border" required />
        </div>
        <div>
          <Label className="font-body text-sm">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1 bg-muted border-border" required />
        </div>
        <div>
          <Label className="font-body text-sm">Why do you want access?</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="I'm a screenwriter looking to..." className="mt-1 bg-muted border-border" rows={3} />
        </div>
        <Button type="submit" disabled={loading} className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
          {loading ? "Submitting..." : "Apply for Access"}
        </Button>
      </form>
    </div>
  );
}

export default function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { signupsOpen } = useSiteSettings();
  const { isLocked, remainingLockSeconds, attempts, maxAttempts, recordFailure, resetAttempts, getDelay } = useLoginRateLimit();

  const showDemoForm = !signupsOpen && location.hash === "#demo-request";

  // Capture referral code and invited flag from URL
  const searchParams = new URLSearchParams(location.search);
  const refCode = searchParams.get("ref");
  const isInvitedParam = searchParams.get("invited") === "1";

  // Allow signup when signups are open OR user arrived via invite link
  const canSignUp = signupsOpen || isInvitedParam;

  // Force sign-in mode when signups are closed and not invited
  useEffect(() => {
    if (!canSignUp && isSignUp) setIsSignUp(false);
  }, [canSignUp, isSignUp]);

  async function recordReferral(userId: string, code: string) {
    const { data: referrerId } = await supabase
      .rpc("find_user_by_referral_code", { code });
    const referrer = referrerId ? { user_id: referrerId } : null;

    if (referrer?.user_id && referrer.user_id !== userId) {
      await supabase.from("referrals" as any).insert({
        referrer_id: referrer.user_id,
        referred_id: userId,
        referral_code: code.toUpperCase(),
      } as any);
    }
  }

  useEffect(() => {
    if (user) {
      if (refCode) {
        recordReferral(user.id, refCode);
      }
      const dest = resolveRedirectPath(location.search, "/my-submissions");
      clearAccessIntent();
      navigate(dest);
    }
  }, [user, navigate, refCode, location.search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    if (isLocked) {
      toast({ title: "Too many attempts", description: `Please wait ${remainingLockSeconds}s before trying again.`, variant: "destructive" });
      return;
    }
    setLoading(true);

    // Progressive delay based on failed attempts
    await getDelay();

    if (isSignUp) {
      // When signups are closed, the database auth trigger validates the
      // invited email without exposing a public email-status lookup RPC.
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        recordFailure();
        const description = signupsOpen
          ? error.message
          : "Account creation is limited to invited emails during the closed trial.";
        setInviteError(description);
        toast({ title: "Unable to create account", description, variant: "destructive" });
      } else {
        resetAttempts();
        if (signUpData.user && displayName) {
          await supabase.from("profiles").update({ display_name: displayName }).eq("user_id", signUpData.user.id);
        }
        toast({ title: "Check your email", description: "We sent you a confirmation link." });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        recordFailure();
        const attemptsLeft = maxAttempts - (attempts + 1);
        const desc = attemptsLeft > 0
          ? `${error.message} (${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining)`
          : `${error.message}. Account temporarily locked for 60 seconds.`;
        toast({ title: "Error", description: desc, variant: "destructive" });
      } else {
        resetAttempts();
        const dest = resolveRedirectPath(location.search, "/my-submissions");
        clearAccessIntent();
        navigate(dest);
      }
    }
    setLoading(false);
  }

  return (
    <section className="min-h-screen pt-20 pb-20 flex items-center">
      <div className="container max-w-md">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-display text-3xl font-bold mb-2 text-center">
            {isForgot ? "Reset Password" : isSignUp ? "Create Account" : "Sign In"}
          </h1>
          <p className="text-muted-foreground text-center mb-8">
            {isForgot ? "We'll send you a reset link" : isSignUp ? "Join the competition" : "Welcome back"}
          </p>

          <div className="space-y-4 rounded-xl border border-border/50 bg-card/80 p-8">
            <Button
              type="button"
              variant="outline"
              className="w-full font-body font-semibold"
              onClick={async () => {
                const { error } = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: `${window.location.origin}/auth${location.search}`,
                });
                if (error) {
                  toast({ title: "Error", description: String(error), variant: "destructive" });
                }
              }}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {isForgot ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/reset-password`,
                  });
                  if (error) {
                    toast({ title: "Error", description: error.message, variant: "destructive" });
                  } else {
                    toast({ title: "Check your email", description: "We sent you a password reset link." });
                  }
                  setLoading(false);
                }}
                className="space-y-4"
              >
                <div>
                  <Label className="font-body text-sm">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1.5 bg-muted border-border"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
                >
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  <button type="button" onClick={() => setIsForgot(false)} className="text-primary hover:underline">
                    Back to sign in
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSignUp && (
                  <div>
                    <Label className="font-body text-sm">Display Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="mt-1.5 bg-muted border-border"
                      required
                    />
                  </div>
                )}
                <div>
                  <Label className="font-body text-sm">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setInviteError(""); }}
                    placeholder="you@example.com"
                    className="mt-1.5 bg-muted border-border"
                    required
                  />
                </div>
                <div>
                  <Label className="font-body text-sm">Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1.5 bg-muted border-border"
                    minLength={6}
                    required
                  />
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={() => setIsForgot(true)}
                      className="text-xs text-muted-foreground hover:text-primary mt-1.5"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                {inviteError && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-center">
                    <p className="text-sm text-destructive font-medium">{inviteError}</p>
                  </div>
                )}
                {isLocked && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-center">
                    <p className="text-sm text-destructive font-medium">
                      Too many failed attempts. Try again in {remainingLockSeconds}s.
                    </p>
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={loading || isLocked}
                  className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
                >
                  {isLocked ? `Locked (${remainingLockSeconds}s)` : loading ? "Loading..." : isSignUp ? "Create Account" : "Sign In"}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {isSignUp ? "Already have an account?" : canSignUp ? "Don't have an account?" : ""}{" "}
                  {canSignUp && (
                    <button
                      type="button"
                      onClick={() => setIsSignUp(!isSignUp)}
                      className="text-primary hover:underline"
                    >
                      {isSignUp ? "Sign in" : "Sign up"}
                    </button>
                  )}
                </p>
              </form>
            )}
          </div>

          {/* Early Access Form — shown when signups are closed and no invite */}
          {!canSignUp && <DemoRequestForm />}
          {!showDemoForm && !canSignUp && (
            <p className="text-center text-xs text-muted-foreground mt-4">
              Sign-ups are currently closed.{" "}
              <a href="/auth#demo-request" className="text-primary hover:underline">Apply for early access</a>
            </p>
          )}
        </motion.div>
      </div>
    </section>
  );
}
