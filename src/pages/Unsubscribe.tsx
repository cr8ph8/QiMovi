import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MailX, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    validateToken(token);
  }, [token]);

  async function validateToken(t: string) {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(t)}`,
        { headers: { apikey: anonKey } }
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus("invalid");
      } else if (data.valid === false && data.reason === "already_unsubscribed") {
        setStatus("already");
      } else if (data.valid) {
        setStatus("valid");
      } else {
        setStatus("invalid");
      }
    } catch {
      setStatus("invalid");
    }
  }

  async function handleConfirm() {
    if (!token) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) {
        setStatus("error");
      } else if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
    setProcessing(false);
  }

  return (
    <section className="min-h-screen pt-20 pb-20 flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4">
        <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
          {status === "loading" && (
            <>
              <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Verifying your request…</p>
            </>
          )}

          {status === "valid" && (
            <>
              <MailX className="h-10 w-10 text-primary mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold mb-2">Unsubscribe</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Are you sure you want to unsubscribe from app emails? You'll stop
                receiving notifications like submission confirmations and score alerts.
              </p>
              <Button
                onClick={handleConfirm}
                disabled={processing}
                className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold"
              >
                {processing ? "Processing…" : "Confirm Unsubscribe"}
              </Button>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold mb-2">Unsubscribed</h1>
              <p className="text-sm text-muted-foreground">
                You've been successfully unsubscribed. You won't receive further app emails.
              </p>
            </>
          )}

          {status === "already" && (
            <>
              <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold mb-2">Already Unsubscribed</h1>
              <p className="text-sm text-muted-foreground">
                You've already unsubscribed from app emails. No further action needed.
              </p>
            </>
          )}

          {status === "invalid" && (
            <>
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold mb-2">Invalid Link</h1>
              <p className="text-sm text-muted-foreground">
                This unsubscribe link is invalid or has expired.
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
              <h1 className="font-display text-xl font-bold mb-2">Something Went Wrong</h1>
              <p className="text-sm text-muted-foreground">
                We couldn't process your request. Please try again later.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
