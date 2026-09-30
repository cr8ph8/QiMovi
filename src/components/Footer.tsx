import { Link } from "react-router-dom";
import { useSiteSettings } from "@/hooks/useSiteSettings";

export function Footer() {
  const { launchState, publicCta, publicSubmissionsOpen } = useSiteSettings();
  return (
    <footer className="border-t border-border/50 bg-surface-overlay">
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded bg-gold-gradient flex items-center justify-center">
                <span className="font-display text-sm font-bold text-primary-foreground">CI</span>
              </div>
              <span className="font-display text-lg font-semibold tracking-tight">
                Can<span className="text-gradient-gold">I</span>Screenwrite
              </span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Evaluating storytelling across intelligence types.
            </p>
          </div>
          <div>
            <h4 className="font-body text-sm font-semibold mb-3 text-foreground">Compete</h4>
            <div className="flex flex-col gap-2">
              <Link to="/ai-competition" className="text-sm text-muted-foreground hover:text-foreground transition-colors">AI Competition</Link>
              {publicSubmissionsOpen ? (
                <Link to="/submit" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Submit Entry</Link>
              ) : launchState === "open" ? (
                <span className="text-sm text-muted-foreground/70">Submissions Paused</span>
              ) : (
                <Link to={publicCta.to} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{publicCta.label}</Link>
              )}
              <Link to="/faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
            </div>
          </div>
          <div>
            <h4 className="font-body text-sm font-semibold mb-3 text-foreground">Platform</h4>
            <div className="flex flex-col gap-2">
              <Link to="/platform" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Overview</Link>
              <Link to="/qi-list" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Qi-List</Link>
              <Link to="/future-readers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Future Readers</Link>
              <Link to="/seasons" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Seasons</Link>
              <Link to="/god-mode" className="text-sm text-muted-foreground hover:text-foreground transition-colors">God Mode</Link>
            </div>
          </div>
          <div>
            <h4 className="font-body text-sm font-semibold mb-3 text-foreground">Governance</h4>
            <div className="flex flex-col gap-2">
              <Link to="/governance" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Overview</Link>
              <Link to="/signalcheck/analyze" className="text-sm text-muted-foreground hover:text-foreground transition-colors">SignalCheck</Link>
              <Link to="/authorship-shield" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Authorship Shield</Link>
              <Link to="/framework/q2e" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Q2E Framework</Link>
            </div>
          </div>
          <div className="md:col-span-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2">
              <span className="text-xs text-muted-foreground">Terms of Service</span>
              <span className="text-xs text-muted-foreground">Privacy Policy</span>
              <span className="text-xs text-muted-foreground">Competition Rules</span>
            </div>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2026 CanIScreenwrite. All rights reserved.</p>
          <p className="text-xs text-muted-foreground italic">Can Intelligence Write a Great Screenplay?</p>
        </div>
      </div>
    </footer>
  );
}
