import { useEffect, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type State =
  | { kind: "loading" }
  | { kind: "success"; entryId: string }
  | { kind: "error"; message: string };

export default function CollaboratorAcceptPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    document.title = "Accept Collaborator Invitation · Qi | Can I Screenwrite?";
    (async () => {

      if (!token) {
        setState({ kind: "error", message: "Missing invitation token." });
        return;
      }
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) {
        navigate(
          `/auth?next=${encodeURIComponent(`/collab/accept?token=${token}`)}`,
          { replace: true }
        );
        return;
      }
      const { data, error } = await supabase.rpc(
        "accept_collaborator_invitation" as any,
        { p_token: token }
      );
      if (error) {
        setState({ kind: "error", message: error.message || "Could not accept invitation" });
        return;
      }
      const row = data as any;
      setState({ kind: "success", entryId: row?.entry_id });
    })();
  }, [token, navigate]);

  return (
    <div className="container mx-auto px-4 py-16 max-w-lg">

      <Card className="p-8 text-center bg-card/40 border-border/60">
        {state.kind === "loading" && (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
            <h1 className="text-xl font-display font-semibold">
              Accepting invitation…
            </h1>
          </>
        )}
        {state.kind === "success" && (
          <>
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-3" />
            <h1 className="text-2xl font-display font-semibold mb-2">
              You're in.
            </h1>
            <p className="text-muted-foreground mb-6">
              You've joined the screenplay. Open the workspace to start collaborating.
            </p>
            <Button onClick={() => navigate(`/entry/${state.entryId}`)}>
              Open screenplay
            </Button>
          </>
        )}
        {state.kind === "error" && (
          <>
            <XCircle className="h-10 w-10 mx-auto text-destructive mb-3" />
            <h1 className="text-2xl font-display font-semibold mb-2">
              We couldn't accept this invitation
            </h1>
            <p className="text-muted-foreground mb-6">{state.message}</p>
            <Button variant="outline" onClick={() => navigate("/")}>
              Back to home
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
