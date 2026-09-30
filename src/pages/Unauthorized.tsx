import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogIn, FileText } from "lucide-react";

export default function Unauthorized() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cinema px-6">
      <div className="max-w-md text-center">
        <ShieldAlert className="h-12 w-12 text-primary mx-auto mb-4" aria-hidden="true" />
        <h1 className="font-display text-3xl mb-3">Restricted area</h1>
        <p className="text-muted-foreground mb-6">
          This surface is only available to entrants. If you already have an
          entrant account, sign in to continue. Newcomers can review the AI
          Competition entry instructions below.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
          <Button asChild>
            <Link to="/auth">
              <LogIn className="h-4 w-4 mr-2" aria-hidden="true" />
              Sign in as an entrant
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/ai-competition">
              <FileText className="h-4 w-4 mr-2" aria-hidden="true" />
              AI Competition instructions
            </Link>
          </Button>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

