import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import ShieldAnalyticsPanel from "@/components/admin/ShieldAnalyticsPanel";

export default function ShieldAnalytics() {
  return (
    <div className="container mx-auto max-w-7xl py-10 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/god-mode"><ArrowLeft className="h-3 w-3 mr-1" /> God Mode</Link>
          </Button>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Shield Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live risk distribution, score trends, and certificate issuance across all Authorship Shield runs.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/god-mode/shield-forecast">Shield Forecast →</Link>
        </Button>
      </div>
      <ShieldAnalyticsPanel />
    </div>
  );
}
