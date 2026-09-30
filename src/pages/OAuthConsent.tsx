import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { withRedirect } from "@/lib/accessIntent";
import { AlertTriangle, RefreshCw } from "lucide-react";

// Narrow local wrapper for the beta supabase.auth.oauth namespace.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function getOAuth(): OAuthApi | null {
  const anyAuth = (supabase.auth as unknown) as { oauth?: OAuthApi };
  return anyAuth.oauth ?? null;
}

type ErrKind = "missing_id" | "oauth_disabled" | "expired" | "denied_upstream" | "network" | "unknown";

interface FriendlyError {
  kind: ErrKind;
  title: string;
  body: string;
  raw?: string;
}

function classify(message: string): FriendlyError {
  const m = message.toLowerCase();
  if (m.includes("expired") || m.includes("not_found") || m.includes("not found") || m.includes("invalid_authorization")) {
    return {
      kind: "expired",
      title: "This authorization request expired",
      body: "Consent links are only valid for a few minutes. Return to your assistant (ChatGPT, Claude, Cursor, etc.) and start the connection again — it will send you back here with a fresh link.",
      raw: message,
    };
  }
  if (m.includes("access_denied") || m.includes("denied")) {
    return {
      kind: "denied_upstream",
      title: "The authorization server rejected this request",
      body: "The connecting app or one of its scopes was declined. Try reconnecting from your assistant, or contact support if this keeps happening.",
      raw: message,
    };
  }
  if (m.includes("oauth server") || m.includes("not enabled") || m.includes("feature_disabled")) {
    return {
      kind: "oauth_disabled",
      title: "Agent integrations aren't enabled on this workspace yet",
      body: "The OAuth server isn't configured on the backend. An admin needs to enable it before external assistants can connect.",
      raw: message,
    };
  }
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("timeout")) {
    return {
      kind: "network",
      title: "We couldn't reach the authorization server",
      body: "Check your connection and try again. If your network is fine, the auth service may be briefly unavailable.",
      raw: message,
    };
  }
  return {
    kind: "unknown",
    title: "Something went wrong finishing this connection",
    body: "The authorization server returned an unexpected error. You can retry, or start the connection over from your assistant.",
    raw: message,
  };
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setDetails(null);
    if (!authorizationId) {
      setError({
        kind: "missing_id",
        title: "This link is missing an authorization id",
        body: "Open the connection flow again from your assistant so it can send a valid authorization link.",
      });
      return;
    }
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = withRedirect("/auth", returnTo);
      return;
    }
    const oauth = getOAuth();
    if (!oauth) {
      setError(classify("OAuth server not enabled"));
      return;
    }
    try {
      const { data, error: apiError } = await oauth.getAuthorizationDetails(authorizationId);
      if (apiError) {
        setError(classify(apiError.message || String(apiError)));
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    } catch (e: any) {
      setError(classify(e?.message ?? "Network error"));
    }
  }, [authorizationId]);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  async function decide(approve: boolean) {
    const oauth = getOAuth();
    if (!oauth) return;
    setBusy(true);
    try {
      const { data, error: apiError } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (apiError) {
        setBusy(false);
        setError(classify(apiError.message || String(apiError)));
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError(classify("No redirect returned by the authorization server."));
        return;
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(classify(e?.message ?? "Network error"));
    }
  }

  function retry() {
    setBusy(false);
    setAttempt((a) => a + 1);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-20">
      <div className="w-full max-w-md rounded-xl border border-border/50 bg-card/80 p-8 space-y-4">
        {error ? (
          <>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h1 className="font-display text-2xl font-bold">{error.title}</h1>
            </div>
            <p className="text-sm text-muted-foreground">{error.body}</p>
            {error.raw && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">{error.raw}</pre>
              </details>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              {error.kind !== "missing_id" && error.kind !== "oauth_disabled" && (
                <Button onClick={retry} disabled={busy} className="flex-1">
                  <RefreshCw className={`h-4 w-4 mr-1 ${busy ? "animate-spin" : ""}`} />
                  Try again
                </Button>
              )}
              <Button asChild variant="outline" className="flex-1">
                <Link to="/agent-integrations">Back to Agent integrations</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Still stuck? Start the connection over from your assistant — most consent errors clear up with a fresh link.
            </p>
          </>
        ) : !details ? (
          <>
            <h1 className="font-display text-2xl font-bold">Loading…</h1>
            <p className="text-sm text-muted-foreground">Preparing the authorization request.</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">
              Connect {details.client?.name ?? details.client?.client_name ?? "an app"} to your account
            </h1>
            <p className="text-sm text-muted-foreground">
              This lets {details.client?.name ?? "the requesting app"} use CanIScreenwrite as you — reading your
              screenplays and scores through the platform's MCP tools.
            </p>
            {details.scopes?.length ? (
              <ul className="text-xs text-muted-foreground list-disc pl-5">
                {details.scopes.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-3 pt-2">
              <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
                Approve
              </Button>
              <Button disabled={busy} onClick={() => decide(false)} variant="outline" className="flex-1">
                Deny
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

