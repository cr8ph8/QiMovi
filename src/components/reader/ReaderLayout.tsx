import { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Film, BookOpen, Network, Archive, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to: string;
  icon: typeof Film;
}

export function ReaderLayout({ children }: { children: ReactNode }) {
  const { entryId } = useParams();
  const loc = useLocation();

  const root: NavItem[] = [{ label: "Script Club", to: "/reader", icon: BookOpen }];
  const inEntry = !!entryId;
  const entryNav: NavItem[] = inEntry
    ? [
        { label: "Project Hub", to: `/reader/${entryId}`, icon: Network },
        { label: "Showcase", to: `/reader/${entryId}/showcase`, icon: Film },
        { label: "Vault", to: `/reader/${entryId}/vault`, icon: Archive },
      ]
    : [];

  const items = inEntry ? entryNav : root;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Cinema Aurea top bar */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
          <Link to="/reader" className="flex items-center gap-2 group">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Film className="w-3.5 h-3.5" />
            </span>
            <span className="font-display text-base tracking-wide text-foreground group-hover:text-primary transition-colors">
              Reader
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hidden sm:inline">
              Cinema Aurea
            </span>
          </Link>

          <nav className="ml-2 flex items-center gap-1 overflow-x-auto">
            {items.map((it) => {
              const active = loc.pathname === it.to;
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors whitespace-nowrap",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {it.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {inEntry && (
              <Link
                to="/reader"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> All scripts
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
