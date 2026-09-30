import { ArrowLeft, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Public share links previously resolved a capability token and then fetched
 * screenplay text directly from the base `entries` table. That no longer works
 * once public screenplay content access is correctly revoked. Keep the route
 * explicit and fail-closed until one server endpoint validates the token and
 * returns only the approved version/fields in a single operation.
 */
export default function SharedEntry() {
  return (
    <main className="min-h-screen px-4 pt-32 pb-20">
      <div className="mx-auto max-w-lg rounded-2xl border border-border/50 bg-card/80 p-10 text-center">
        <Lock className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
        <h1 className="font-display text-2xl font-bold mb-2">Shared links are paused</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Secure screenplay sharing is being upgraded. No screenplay text is
          exposed while token validation and access logging are consolidated.
        </p>
        <Button asChild size="sm">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" /> Home
          </Link>
        </Button>
      </div>
    </main>
  );
}
