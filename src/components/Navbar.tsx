import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, LogOut, Coins, UserRound, ChevronDown, FileText, Layers, PenLine, Shield, Gavel, BrainCircuit, Boxes, LayoutTemplate, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { usePlatform } from "@/contexts/PlatformContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { FloatingWallet } from "@/components/FloatingWallet";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { FounderBadge } from "@/components/FounderBadge";
import { useJudgingQueueCount } from "@/hooks/useJudgingQueueCount";
import { HelpMenuButton } from "@/components/tour/HelpMenuButton";

const navItems = [
  { label: "Home", path: "/", tier: null, authOnly: false },
  { label: "AI Competition", path: "/ai-competition", tier: null, authOnly: false },
  { label: "Leaderboard", path: "/leaderboard", tier: "extended" as const, authOnly: false },
  { label: "Qi-List", path: "/qi-list", tier: null, authOnly: true },
  { label: "How It Works", path: "/how-it-works", tier: null, authOnly: false },
  { label: "Governance", path: "/governance", tier: null, authOnly: false },
  { label: "News", path: "/news", tier: null, authOnly: false },
  { label: "Changelog", path: "/changelog", tier: null, authOnly: false },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const writeRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { user, isAdmin, isJudge, hasAccessTier, signOut } = useAuth();
  const { balance } = useWallet();
  const { mode } = usePlatform();
  const { plan } = useSubscription();
  const {
    launchState,
    publicCta,
    publicSubmissionsOpen,
    submissionsOpen,
    signinVisible,
  } = useSiteSettings();
  const publicActionAvailable = launchState !== "open" || publicSubmissionsOpen;
  const queueCount = useJudgingQueueCount(!!user && (isJudge || isAdmin));

  const PLAN_BADGE: Record<string, { label: string; className: string } | null> = {
    free: null,
    pro: { label: "Pro", className: "bg-primary/10 text-primary border-primary/20" },
    studio: { label: "Studio", className: "bg-primary/20 text-primary border-primary/30" },
  };
  const badge = PLAN_BADGE[plan];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (writeRef.current && !writeRef.current.contains(event.target as Node)) {
        setWriteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Two groups so the dropdown mirrors the workspace rail's Capture → Write → Submit flow.
  const startLinks = [
    { label: "Brain Dump", path: "/brain-dump", icon: BrainCircuit, hint: "Capture raw ideas" },
    { label: "New Script", path: "/write", icon: PenLine, hint: "Open a blank Fountain editor" },
    { label: "Templates", path: "/templates", icon: LayoutTemplate, hint: "Start from a structure" },
  ];
  const continueLinks = [
    { label: "Drafts", path: "/my-drafts", icon: FileText, hint: "In-progress screenplays" },
    { label: "Submissions", path: "/my-submissions", icon: Layers, hint: "Submitted entries" },
    { label: "Universes", path: "/qi-list", icon: Boxes, hint: "Franchise & project groups" },
  ];
  const writeLinks = [...startLinks, ...continueLinks];

  // Resume last draft — loaded lazily on dropdown open.
  const [lastDraft, setLastDraft] = useState<{ id: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!writeOpen || !user || lastDraft !== null) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("screenplay_drafts")
        .select("id,title")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setLastDraft({ id: data.id, title: data.title });
    })();
    return () => { cancelled = true; };
  }, [writeOpen, user, lastDraft]);

  const isWriteActive =
    writeLinks.some((l) => location.pathname === l.path || location.pathname.startsWith(l.path + "/")) ||
    location.pathname.startsWith("/entry/") ||
    location.pathname.startsWith("/brain-dump");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-gold-gradient flex items-center justify-center">
            <span className="font-display text-sm font-bold text-primary-foreground">CI</span>
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">
            Can<span className="text-gradient-gold">I</span>Screenwrite
          </span>
        </Link>
        {mode === "developer" && (
          <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">DEV</span>
        )}
        {isAdmin && (
          <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
            Ops
          </span>
        )}

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navItems
            .filter((item) => (!item.tier || hasAccessTier(item.tier)) && (!item.authOnly || user))
            .map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-2 text-sm font-body transition-colors rounded-md ${
                location.pathname === item.path
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {isAdmin ? (
            <Link
              to="/god-mode"
              className={`group flex items-center gap-1.5 px-3 py-1.5 ml-1 text-sm font-body font-semibold rounded-md border transition-all ${
                location.pathname.startsWith("/god-mode")
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-[0_0_12px_-2px_rgba(245,158,11,0.4)]"
                  : "bg-amber-500/5 text-amber-400/90 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40"
              }`}
              title="Operator controls"
            >
              <Shield className="h-3.5 w-3.5" />
              Admin Control
            </Link>
          ) : isJudge ? (
            <Link
              to="/judges"
              className={`group flex items-center gap-1.5 px-3 py-1.5 ml-1 text-sm font-body font-semibold rounded-md border transition-all ${
                location.pathname.startsWith("/god-mode")
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-[0_0_12px_-2px_rgba(245,158,11,0.4)]"
                  : "bg-amber-500/5 text-amber-400/90 border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40"
              }`}
              title="Judging console"
            >
              <Gavel className="h-3.5 w-3.5" />
              Judging
            </Link>
          ) : null}
          {user ? (
            <div className="flex items-center gap-2 ml-3">
              <HelpMenuButton />
              <NotificationBell />
              <div className="relative" data-tour="wallet">
                {balance !== null && (
                  <button
                    onClick={() => setPurchaseOpen(!purchaseOpen)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <Coins className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-mono font-semibold text-primary">{balance}</span>
                  </button>
                )}
                <FloatingWallet open={purchaseOpen} onClose={() => setPurchaseOpen(false)} />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
                        {user.email?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    {(isJudge || isAdmin) && queueCount !== null && queueCount > 0 && (
                      <span
                        className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-mono font-bold text-background flex items-center justify-center shadow-[0_0_8px_-1px_rgba(245,158,11,0.7)] ring-2 ring-background animate-pulse"
                        title={`${queueCount} awaiting judging`}
                        aria-label={`${queueCount} items awaiting judging`}
                      >
                        {queueCount > 99 ? "99+" : queueCount}
                      </span>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to={`/writer/${user.id}`} className="cursor-pointer flex items-center">
                      <UserRound className="h-4 w-4 mr-2 shrink-0" />
                      <span className="flex-1">Profile</span>
                      {badge && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 font-mono ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      )}
                      <FounderBadge />
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/collaborators" className="cursor-pointer">
                      <span className="h-4 w-4 mr-2 flex items-center justify-center text-muted-foreground shrink-0">@</span>
                      Invites
                    </Link>
                  </DropdownMenuItem>
                  {(isJudge || isAdmin) && (
                    <DropdownMenuItem asChild>
                      <Link to="/judges" className="cursor-pointer flex items-center">
                        <Gavel className="h-4 w-4 mr-2 shrink-0 text-amber-400" />
                        <span className="flex-1 text-amber-400">Judges Console</span>
                        {queueCount !== null && queueCount > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/40 px-1.5 py-0 h-4 text-[10px] font-mono font-bold text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                            {queueCount > 99 ? "99+" : queueCount}
                          </span>
                        )}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="cursor-pointer text-muted-foreground focus:text-destructive">
                    <LogOut className="h-4 w-4 mr-2 shrink-0" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="relative" ref={writeRef} data-tour="write-menu">
                <button
                  onClick={() => setWriteOpen(!writeOpen)}
                  className={`flex items-center gap-1 px-3 py-2 text-sm font-body transition-colors rounded-md ${
                    isWriteActive
                      ? "text-primary bg-muted/50"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Write
                  {isWriteActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${writeOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {writeOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-border/60 bg-background/95 backdrop-blur-xl shadow-lg overflow-hidden"
                    >
                      {lastDraft && (
                        <Link
                          to={`/entry/${lastDraft.id}#write`}
                          onClick={() => setWriteOpen(false)}
                          className="flex items-center gap-2 px-3 py-3 border-b border-border/50 bg-primary/5 hover:bg-primary/10 transition-colors group"
                        >
                          <div className="h-7 w-7 rounded bg-primary/15 flex items-center justify-center shrink-0">
                            <PenLine className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Resume last draft</div>
                            <div className="text-sm font-body text-foreground truncate">{lastDraft.title || "Untitled draft"}</div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      )}
                      {([
                        { label: "Start", items: startLinks },
                        { label: "Continue", items: continueLinks },
                      ] as const).map((group) => (
                        <div key={group.label} className="py-1">
                          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono">
                            {group.label}
                          </div>
                          {group.items.map((link) => {
                            const Icon = link.icon;
                            const active = location.pathname === link.path || location.pathname.startsWith(link.path + "/");
                            return (
                              <Link
                                key={link.path}
                                to={link.path}
                                onClick={() => setWriteOpen(false)}
                                className={`relative flex items-start gap-2.5 px-3 py-2 text-sm font-body transition-colors ${
                                  active
                                    ? "text-primary bg-muted/50"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                }`}
                              >
                                {active && (
                                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-primary" />
                                )}
                                <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="leading-tight">{link.label}</span>
                                  <span className="text-[11px] text-muted-foreground/70 leading-tight">{link.hint}</span>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {submissionsOpen && (
                <Link to="/submit" data-tour="submit-cta">
                  <Button size="sm" className="bg-gold-gradient font-body font-semibold text-primary-foreground hover:opacity-90">
                    Enter Now
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-3">
              {signinVisible && (
                <Link to="/auth">
                  <Button size="sm" variant="outline" className="font-body">Sign In</Button>
                </Link>
              )}
              {publicActionAvailable ? (
                <Link to={publicCta.to}>
                  <Button size="sm" className="bg-gold-gradient font-body font-semibold text-primary-foreground hover:opacity-90">
                    {publicCta.label}
                  </Button>
                </Link>
              ) : (
                <Button size="sm" variant="outline" disabled className="font-body">
                  Submissions Paused
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl"
          >
            <div className="container py-4 flex flex-col gap-2">
              {navItems
                .filter((item) => (!item.tier || hasAccessTier(item.tier)) && (!item.authOnly || user))
                .map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 text-sm font-body rounded-md ${
                    location.pathname === item.path ? "text-primary bg-muted" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {isAdmin ? (
                <Link
                  to="/god-mode"
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 text-sm font-body font-semibold rounded-md border flex items-center gap-1.5 ${
                    location.pathname.startsWith("/god-mode")
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                      : "bg-amber-500/5 text-amber-400/90 border-amber-500/20"
                  }`}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Admin Control
                </Link>
              ) : isJudge ? (
                <Link
                  to="/god-mode"
                  onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 text-sm font-body font-semibold rounded-md border flex items-center gap-1.5 ${
                    location.pathname.startsWith("/god-mode")
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                      : "bg-amber-500/5 text-amber-400/90 border-amber-500/20"
                  }`}
                >
                  <Gavel className="h-3.5 w-3.5" />
                  Judging
                </Link>
              ) : null}
              {user ? (
                <>
                  <Link to={`/writer/${user.id}`} onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-body rounded-md text-muted-foreground flex items-center gap-1.5">
                    <UserRound className="h-4 w-4" /> Profile
                  </Link>
                   <Link to="/collaborators" onClick={() => setMobileOpen(false)} className="px-3 py-2 text-sm font-body rounded-md text-muted-foreground">
                     Invites
                   </Link>
                   <div className={`px-3 py-2 text-sm font-body rounded-md font-semibold flex items-center gap-2 ${isWriteActive ? "text-primary bg-muted/40" : "text-muted-foreground"}`}>
                     <PenLine className="h-4 w-4" />
                     Write
                     {isWriteActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                   </div>
                   {writeLinks.map((link) => {
                     const Icon = link.icon;
                     const active = location.pathname === link.path || location.pathname.startsWith(link.path + "/");
                     return (
                       <Link
                         key={link.path}
                         to={link.path}
                         onClick={() => setMobileOpen(false)}
                         className={`pl-6 pr-3 py-2 text-sm font-body rounded-md flex items-center gap-2 transition-colors ${
                           active
                             ? "text-primary bg-muted"
                             : "text-muted-foreground hover:bg-muted/30"
                         }`}
                       >
                         {active && (
                           <span className="h-4 w-[3px] rounded-r-full bg-primary shrink-0" />
                         )}
                         <Icon className="h-4 w-4" />
                         {link.label}
                       </Link>
                     );
                   })}
                  {submissionsOpen && (
                    <Link to="/submit" onClick={() => setMobileOpen(false)}>
                      <Button size="sm" className="mt-2 w-full bg-gold-gradient font-body font-semibold text-primary-foreground">Enter Now</Button>
                    </Link>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { signOut(); setMobileOpen(false); }} className="w-full font-body">
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  {signinVisible && (
                    <Link to="/auth" onClick={() => setMobileOpen(false)}>
                      <Button size="sm" variant="outline" className="mt-2 w-full font-body">Sign In</Button>
                    </Link>
                  )}
                  {publicActionAvailable ? (
                    <Link to={publicCta.to} onClick={() => setMobileOpen(false)}>
                      <Button size="sm" className="w-full bg-gold-gradient font-body font-semibold text-primary-foreground">{publicCta.label}</Button>
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" disabled className="w-full font-body">Submissions Paused</Button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
    </nav>
  );
}
