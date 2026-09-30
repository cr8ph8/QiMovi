import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      navigate("/");
    }
    setLoading(false);
  }

  if (!isRecovery) {
    return (
      <section className="min-h-screen pt-20 pb-20 flex items-center">
        <div className="container max-w-md text-center">
          <h1 className="font-display text-2xl font-bold mb-4">Invalid Link</h1>
          <p className="text-muted-foreground mb-6">
            This password reset link is invalid or has expired.
          </p>
          <Button onClick={() => navigate("/auth")} variant="outline">
            Back to Sign In
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen pt-20 pb-20 flex items-center">
      <div className="container max-w-md">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-display text-3xl font-bold mb-2 text-center">
            Set New Password
          </h1>
          <p className="text-muted-foreground text-center mb-8">
            Enter your new password below
          </p>

          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-border/50 bg-card/80 p-8"
          >
            <div>
              <Label className="font-body text-sm">New Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 bg-muted border-border"
                minLength={6}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
            >
              {loading ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </motion.div>
      </div>
    </section>
  );
}
