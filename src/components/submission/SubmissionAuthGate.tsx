import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/useWallet";

interface SubmissionAuthGateProps {
  /** Action label context e.g. "Submit" or "Save" */
  actionLabel?: string;
  /** Called after successful login when there's a pending PDF url to re-parse */
  pdfUrl?: string;
  onParseResult?: (data: any) => void;
}

export default function SubmissionAuthGate({ actionLabel = "Submit", pdfUrl, onParseResult }: SubmissionAuthGateProps) {
  const { toast } = useToast();
  const wallet = useWallet();
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast({ title: "Check your email", description: "We sent you a confirmation link. Please verify your email to continue." });
      } else {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Welcome back!" });
        if (pdfUrl && onParseResult) {
          const { data } = await supabase.functions.invoke("parse-screenplay", { body: { pdf_url: pdfUrl } });
          if (data && !data.error) {
            onParseResult({ ...data, signInUser: signInData.user });
          }
          wallet.refresh();
        }
      }
    } catch (e: any) {
      toast({ title: "Auth failed", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/30 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <LogIn className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          {authMode === "signup" ? "Create an Account" : "Sign In"} to {actionLabel}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full font-semibold gap-2"
        onClick={async () => {
          const { error } = await lovable.auth.signInWithOAuth("google", {
            redirect_uri: window.location.origin,
          });
          if (error) toast({ title: "Google sign-in failed", description: error.message, variant: "destructive" });
        }}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </Button>

      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-border/30" />
        <span className="text-xs text-muted-foreground font-mono">or email</span>
        <div className="flex-1 border-t border-border/30" />
      </div>

      <form onSubmit={handleAuth} className="space-y-3">
        {authMode === "signup" && (
          <div>
            <Label className="text-sm">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              className="mt-1 bg-muted border-border"
            />
          </div>
        )}
        <div>
          <Label className="text-sm">Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="mt-1 bg-muted border-border"
          />
        </div>
        <div>
          <Label className="text-sm">Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            className="mt-1 bg-muted border-border"
          />
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="w-full bg-gold-gradient text-primary-foreground font-semibold"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {authMode === "signup" ? "Sign Up & Claim Tokens" : "Sign In"}
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          {authMode === "signup" ? (
            <>Already have an account?{" "}
              <button type="button" onClick={() => setAuthMode("login")} className="text-primary hover:underline">Sign in</button>
            </>
          ) : (
            <>Need an account?{" "}
              <button type="button" onClick={() => setAuthMode("signup")} className="text-primary hover:underline">Sign up</button>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
