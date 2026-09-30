import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { PlatformSwitcher } from "./platform/PlatformSwitcher";
import { DeveloperPanel } from "./platform/DeveloperPanel";
import { TesterFeedbackButton } from "./TesterFeedbackButton";
import { TourProvider } from "./tour/TourProvider";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useAuth } from "@/hooks/useAuth";
import { Wrench, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "react-router-dom";

function MaintenanceBanner({ eta }: { eta: string | null }) {
  const etaDate = eta ? new Date(eta) : null;
  const showEta = etaDate && etaDate.getTime() > Date.now();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="rounded-2xl border border-border/50 bg-card/80 p-12 max-w-lg">
        <Wrench className="h-14 w-14 text-primary mx-auto mb-6" />
        <h1 className="text-3xl font-display font-bold mb-3">We'll Be Back Soon</h1>
        <p className="text-muted-foreground font-body leading-relaxed">
          We're performing scheduled maintenance to improve your experience.
          Please check back shortly.
        </p>
        {showEta && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground font-mono">
            <Clock className="h-4 w-4 text-primary" />
            Estimated return: {format(etaDate!, "PPP 'at' p")}
          </div>
        )}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { maintenanceMode, maintenanceEta, loading } = useSiteSettings();
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();

  // Embed routes render bare — no navbar/footer/chrome — so they can live inside an iframe.
  if (pathname.startsWith("/embed/")) {
    return <>{children}</>;
  }

  if (!loading && maintenanceMode && !isAdmin) {
    return <MaintenanceBanner eta={maintenanceEta} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-cinema">
      {maintenanceMode && isAdmin && (
        <div className="bg-destructive/10 text-destructive text-xs font-mono text-center py-1.5 flex items-center justify-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          Maintenance mode is ON — only admins can see the site
        </div>
      )}
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
      <PlatformSwitcher />
      <DeveloperPanel />
      <TesterFeedbackButton />
      <TourProvider />
    </div>
  );
}
