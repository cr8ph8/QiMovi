import { ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GitCommit,
  GitPullRequest,
  CircleDot,
  BookOpen,
  EyeOff,
  Gavel,
  Link2,
  Loader2,
  LucideIcon,
  MessageSquarePlus,
  RefreshCw,
  Settings2,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { cachedFetch } from "@/lib/net/linkPreviewClient";
import { ReceiptTrail, type ReceiptEntry } from "./ReceiptTrail";
import {
  useEvidenceViewerRole,
  EVIDENCE_ROLE_LABEL,
  EVIDENCE_ROLE_DESCRIPTION,
  type EvidenceViewerRole,
} from "./useEvidenceViewerRole";
import { logEvidenceAudit } from "@/lib/evidenceAudit";
import { announce } from "@/lib/a11y/announce";

export interface EvidenceFact {
  label: string;
  value: ReactNode;
  mono?: boolean;
  hash?: boolean;
  trailing?: ReactNode;
}

export type EvidenceTone = "default" | "shield" | "gold" | "muted" | "danger";

export interface EvidenceLink {
  label: string;
  url: string;
  kind?: "pr" | "spec" | "issue" | "commit" | "doc";
}

export interface EvidenceDisclosure {
  label: string;
  tone?: "default" | "success" | "warn" | "danger";
  note?: string;
}

export interface EvidenceDetails {
  /** Text on the badge/button that opens the drawer. */
  triggerLabel?: string;
  /** Optional page title inside the drawer. Falls back to card title. */
  drawerTitle?: string;
  /** Short description shown under the drawer title. */
  drawerDescription?: string;
  /** AI/authorship disclosure status pill. */
  disclosure?: EvidenceDisclosure;
  /** Full receipt trail rendered by the shared ReceiptTrail component. */
  receipts: ReceiptEntry[];
  /** External metadata links (PRs, specs, issues, commits, docs). */
  links?: EvidenceLink[];
  /**
   * Override the automatically-derived viewer role. Use for storybook /
   * preview / admin-impersonation flows only.
   */
  viewerRoleOverride?: EvidenceViewerRole;
}

interface Props {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  tone?: EvidenceTone;
  status?: ReactNode;
  facts?: EvidenceFact[];
  children?: ReactNode;
  actions?: ReactNode;
  /**
   * When provided, renders a "Details" badge in the header that opens a
   * side drawer with the full ReceiptTrail, disclosure status, and any
   * linked PR / spec metadata.
   */
  details?: EvidenceDetails;
  className?: string;
}

const TONE: Record<EvidenceTone, { border: string; iconClass: string; badge: string }> = {
  default: { border: "border-border/50", iconClass: "text-primary", badge: "border-primary/40 text-primary hover:bg-primary/10" },
  shield: { border: "border-shield/30", iconClass: "text-shield", badge: "border-shield/40 text-shield hover:bg-shield/10" },
  gold: { border: "border-gold/30", iconClass: "text-gold", badge: "border-gold/40 text-gold hover:bg-gold/10" },
  muted: { border: "border-border/30", iconClass: "text-muted-foreground", badge: "border-border/40 text-muted-foreground hover:bg-muted/40" },
  danger: { border: "border-red-500/30", iconClass: "text-red-400", badge: "border-red-500/40 text-red-300 hover:bg-red-500/10" },
};

const DISCLOSURE_TONE: Record<NonNullable<EvidenceDisclosure["tone"]>, string> = {
  default: "border-border/40 text-muted-foreground bg-muted/20",
  success: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
  warn: "border-amber-500/40 text-amber-300 bg-amber-500/5",
  danger: "border-red-500/40 text-red-300 bg-red-500/5",
};

const LINK_META: Record<NonNullable<EvidenceLink["kind"]>, { icon: LucideIcon; label: string }> = {
  pr: { icon: GitPullRequest, label: "PR" },
  spec: { icon: FileText, label: "Spec" },
  issue: { icon: CircleDot, label: "Issue" },
  commit: { icon: GitCommit, label: "Commit" },
  doc: { icon: BookOpen, label: "Doc" },
};

function inferLinkKind(url: string): NonNullable<EvidenceLink["kind"]> {
  if (/\/pull\//.test(url)) return "pr";
  if (/\/issues\//.test(url)) return "issue";
  if (/\/commit\//.test(url)) return "commit";
  if (/\.md($|[?#])/i.test(url)) return "spec";
  return "doc";
}

/**
 * EvidenceCard — the shared chrome for presenting evidence, proofs, and
 * receipts across QiCanIScreenwrite. Optionally exposes a "Details" badge
 * that expands into a side drawer with the full ReceiptTrail, disclosure
 * status, and any linked PR/spec metadata.
 */
export function EvidenceCard({
  title,
  subtitle,
  icon: Icon = Shield,
  tone = "default",
  status,
  facts,
  children,
  actions,
  details,
  className,
}: Props) {
  const t = TONE[tone];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reactId = useId();
  const headingId = `evidence-card-title-${reactId}`;
  const drawerTitleId = `evidence-drawer-title-${reactId}`;


  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-xl border bg-card/80 p-5 space-y-4",
        t.border,
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 shrink-0", t.iconClass)} aria-hidden="true" />
          <div className="min-w-0">
            <h4
              id={headingId}
              className="font-display text-base leading-tight truncate"
            >
              {title}
            </h4>
            {subtitle && (
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status}
          {details && (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  ref={triggerRef}
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition min-h-[24px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    t.badge,
                  )}
                  aria-label={`Open evidence details for ${title}`}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-controls={drawerTitleId}
                >
                  {details.triggerLabel ?? "Details"}
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </SheetTrigger>
              <EvidenceDrawerBody
                surfaceTitle={title}
                title={details.drawerTitle ?? title}
                description={details.drawerDescription}
                disclosure={details.disclosure}
                receipts={details.receipts}
                links={details.links}
                viewerRoleOverride={details.viewerRoleOverride}
                open={open}
                onRequestClose={() => setOpen(false)}
                triggerRef={triggerRef}
                titleId={drawerTitleId}
              />


            </Sheet>
          )}
        </div>
      </header>


      {facts && facts.length > 0 && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          {facts.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {f.label}
              </dt>
              <dd
                className={cn(
                  "text-foreground/90 flex items-center gap-1 min-w-0",
                  (f.mono || f.hash) && "font-mono",
                )}
              >
                <span
                  className={cn("truncate", f.hash && "text-[11px]")}
                  title={f.hash && typeof f.value === "string" ? f.value : undefined}
                >
                  {f.hash && typeof f.value === "string" && f.value.length > 12
                    ? `${f.value.slice(0, 10)}…${f.value.slice(-4)}`
                    : f.value}
                </span>
                {f.trailing}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {actions && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
          {actions}
        </div>
      )}
    </section>
  );
}

function redactReceiptsForEntrant(entries: ReceiptEntry[]): ReceiptEntry[] {
  return entries.map((e) => ({
    ...e,
    // Strip cryptographic + operational identifiers. Entrants keep the
    // human-readable narrative (title, badges, notes, timestamp).
    hash: undefined,
    hashLabel: undefined,
    correlationId: undefined,
    actor: undefined,
    actions: undefined,
  }));
}

interface PreviewTrailEntry {
  at: string;
  role: EvidenceViewerRole;
  simulated: boolean;
  receiptsVisible: number;
  receiptsRedacted: number;
  linksVisible: number;
  linksRedacted: number;
}


function EvidenceDrawerBody({
  surfaceTitle,
  title,
  description,
  disclosure,
  receipts,
  links,
  viewerRoleOverride,
  open,
  onRequestClose,
  triggerRef,
  titleId,
}: {
  surfaceTitle: string;
  title: string;
  description?: string;
  disclosure?: EvidenceDisclosure;
  receipts: ReceiptEntry[];
  links?: EvidenceLink[];
  viewerRoleOverride?: EvidenceViewerRole;
  open: boolean;
  onRequestClose?: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  titleId?: string;
}) {

  const derivedRole = useEvidenceViewerRole();
  // Local "Preview as" override — lets entrants and operators simulate what
  // each future audience will see (judge, operator, entrant, or public reader).
  // The external `viewerRoleOverride` prop still wins when a caller pins the
  // role explicitly (e.g. server-driven public evidence pages).
  //
  // Also supports a shareable URL parameter (`?previewRole=<role>`) so an
  // entrant can send a colleague a link that opens this drawer already
  // simulating a specific audience.
  const [searchParams, setSearchParams] = useSearchParams();
  const isValidRole = (raw: unknown): raw is EvidenceViewerRole =>
    typeof raw === "string" &&
    (["operator", "judge", "entrant", "reader"] as const).includes(
      raw as EvidenceViewerRole,
    );
  const urlPreviewRole = ((): EvidenceViewerRole | null => {
    const raw = searchParams.get("previewRole");
    return isValidRole(raw) ? raw : null;
  })();
  // Persist the last-chosen preview role in localStorage so it survives
  // refreshes and new sessions. The URL param wins over storage — a shared
  // link should always render as intended even if the viewer has their own
  // saved preference.
  const STORAGE_KEY = "evidence:previewRole";
  const readStoredRole = (): EvidenceViewerRole | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return isValidRole(raw) ? raw : null;
    } catch {
      return null;
    }
  };
  const [previewRole, setPreviewRoleState] = useState<EvidenceViewerRole | null>(
    () => urlPreviewRole ?? readStoredRole(),
  );
  useEffect(() => {
    if (viewerRoleOverride) return;
    if (urlPreviewRole) setPreviewRoleState(urlPreviewRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPreviewRole, viewerRoleOverride]);
  const setPreviewRole = useCallback(
    (next: EvidenceViewerRole | null) => {
      setPreviewRoleState(next);
      if (typeof window !== "undefined") {
        try {
          if (next) window.localStorage.setItem(STORAGE_KEY, next);
          else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* storage may be disabled — ignore */
        }
      }
      if (viewerRoleOverride) return;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("previewRole", next);
          else p.delete("previewRole");
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams, viewerRoleOverride],
  );
  // Sync when another tab changes the stored preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || viewerRoleOverride) return;
      const next = isValidRole(e.newValue) ? e.newValue : null;
      setPreviewRoleState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [viewerRoleOverride]);
  const role: EvidenceViewerRole =
    viewerRoleOverride ?? previewRole ?? derivedRole;
  const shareLinkUrl = useMemo(() => {
    if (typeof window === "undefined" || !previewRole) return null;
    const url = new URL(window.location.href);
    url.searchParams.set("previewRole", previewRole);
    return url.toString();
  }, [previewRole]);
  const copyShareLink = useCallback(async () => {
    if (!shareLinkUrl) return;
    try {
      await navigator.clipboard.writeText(shareLinkUrl);
      toast.success("Preview link copied", {
        description: `Opens this drawer as ${EVIDENCE_ROLE_LABEL[previewRole!]}.`,
      });
    } catch {
      toast.error("Copy failed");
    }
  }, [shareLinkUrl, previewRole]);
  const isOperator = role === "operator";
  const isJudge = role === "judge";
  const isReader = role === "reader";
  // Operators and judges get the full receipt trail + linked references.
  // Entrants see redacted receipts and no links. Readers (future public
  // audience) get no receipts and no links — only the disclosure banner.
  const fullTrail = isOperator || isJudge;
  const visibleReceipts = isReader
    ? []
    : fullTrail
      ? receipts
      : redactReceiptsForEntrant(receipts);
  const visibleLinks = fullTrail ? links ?? [] : [];
  const linksRedactedCount = fullTrail ? 0 : links?.length ?? 0;

  // In-memory audit trail of role rehearsals for this drawer session. Each
  // entry captures the role that was viewed and exactly what surface content
  // was visible under that role, so entrants and operators can defend their
  // preview decisions with a self-contained record.
  const [previewTrail, setPreviewTrail] = useState<PreviewTrailEntry[]>([]);
  const [trailOpen, setTrailOpen] = useState(false);
  const lastLoggedRoleRef = useRef<EvidenceViewerRole | null>(null);

  // Emit a single audit row per drawer open — with the viewer role and
  // surface identity — so admins can reconstruct who peeked at which
  // evidence pane and when.
  useEffect(() => {
    if (!open) {
      // Announce close transitions too so keyboard users know the sheet
      // dismissed even when focus restores silently.
      announce(`${title} evidence drawer closed`);
      lastLoggedRoleRef.current = null;
      setPreviewTrail([]);
      return;
    }
    logEvidenceAudit("evidence.drawer_view", {
      surfaceTitle,
      viewerRole: role,
      extra: {
        disclosure_label: disclosure?.label ?? null,
        receipt_count: receipts.length,
        link_count: links?.length ?? 0,
      },
    });
    announce(
      `${title} evidence drawer opened, ${EVIDENCE_ROLE_LABEL[role]} view. ${visibleReceipts.length} receipt${visibleReceipts.length === 1 ? "" : "s"}, ${visibleLinks.length} linked reference${visibleLinks.length === 1 ? "" : "s"}.`,
    );
    // Only log on transitions to open — deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Record every effective role change (initial open + every switch) into
  // the preview audit trail and emit an audit event for real switches.
  useEffect(() => {
    if (!open) return;
    if (lastLoggedRoleRef.current === role) return;
    const prev = lastLoggedRoleRef.current;
    const simulated = !!previewRole && !viewerRoleOverride;
    const entry: PreviewTrailEntry = {
      at: new Date().toISOString(),
      role,
      simulated,
      receiptsVisible: visibleReceipts.length,
      receiptsRedacted: receipts.length - visibleReceipts.length,
      linksVisible: visibleLinks.length,
      linksRedacted: linksRedactedCount,
    };
    setPreviewTrail((t) => [...t, entry]);
    if (prev !== null) {
      logEvidenceAudit("evidence.preview_role_switch", {
        surfaceTitle,
        viewerRole: role,
        extra: {
          from_role: prev,
          simulated,
          receipts_visible: entry.receiptsVisible,
          receipts_redacted: entry.receiptsRedacted,
          links_visible: entry.linksVisible,
          links_redacted: entry.linksRedacted,
        },
      });
      announce(
        `Previewing as ${EVIDENCE_ROLE_LABEL[role]}. ${entry.receiptsVisible} receipt${entry.receiptsVisible === 1 ? "" : "s"} visible, ${entry.linksVisible} link${entry.linksVisible === 1 ? "" : "s"} visible.`,
      );
    }
    lastLoggedRoleRef.current = role;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, open]);


  const descId = description ? `${titleId ?? "evidence-drawer"}-desc` : undefined;
  const mainId = `${titleId ?? "evidence-drawer"}-main`;
  const controlsId = `${titleId ?? "evidence-drawer"}-controls`;

  return (
    <SheetContent
      side="right"
      className="w-full sm:max-w-lg overflow-y-auto"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onEscapeKeyDown={(event) => {
        // Explicit Escape handler: prevent any ancestor listener (drawer
        // stacks, hotkey providers) from also handling the key, then close
        // via the controlled `open` state. Focus is restored in
        // `onCloseAutoFocus` below so behavior is consistent whether the
        // user pressed Escape, clicked the overlay, or clicked the X.
        event.stopPropagation();
        onRequestClose?.();
      }}
      onCloseAutoFocus={(event) => {
        // Radix's default focus-restore can be lost when the trigger
        // re-renders between open/close (e.g. status badge updates). Pin
        // focus to the trigger ref we captured on the opener button.
        const trigger = triggerRef?.current;
        if (trigger) {
          event.preventDefault();
          trigger.focus({ preventScroll: false });
        }
      }}
      onOpenAutoFocus={(event) => {
        // Radix would otherwise focus the close (X) button, which drops
        // keyboard users on chrome instead of content. Focus the best
        // starting control inside the drawer:
        //   1. An explicit `[data-evidence-primary-focus]` opt-in.
        //   2. The first Expand / Details / disclosure toggle
        //      (anything with aria-expanded) inside the main region.
        //   3. The <main> landmark itself (tabIndex=-1) as a safe fallback
        //      so screen readers announce the content region.
        const main = document.getElementById(mainId);
        if (!main) return;
        const target =
          (main.querySelector<HTMLElement>("[data-evidence-primary-focus]")) ??
          (main.querySelector<HTMLElement>("button[aria-expanded]")) ??
          main;
        event.preventDefault();
        target.focus({ preventScroll: false });
      }}
    >

      {/* Skip link — visually hidden until focused. Lets keyboard and
          screen-reader users bypass the header, preview-as switcher, and
          disclosure metadata to land directly on the receipt trail. */}
      <a
        href={`#${mainId}`}
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById(mainId);
          if (el) {
            el.focus();
            el.scrollIntoView({ block: "start" });
          }
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-primary/40 focus:bg-background focus:px-3 focus:py-1.5 focus:text-xs focus:font-mono focus:uppercase focus:tracking-wider focus:text-primary focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to evidence drawer content
      </a>
      <SheetHeader className="space-y-2 text-left">
        <SheetTitle id={titleId} className="font-display">
          {title}
        </SheetTitle>
        <SheetDescription id={descId} className="text-xs">
          {description ??
            `Evidence, receipts, and disclosure detail for ${surfaceTitle}.`}
        </SheetDescription>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {disclosure && (
            <Badge
              variant="outline"
              className={cn(
                "w-fit text-[10px] font-mono uppercase tracking-wider",
                DISCLOSURE_TONE[disclosure.tone ?? "default"],
              )}
              title={disclosure.note}
            >
              {disclosure.label}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              fullTrail
                ? "border-primary/40 text-primary bg-primary/5"
                : "border-border/40 text-muted-foreground bg-muted/20",
            )}
            title={EVIDENCE_ROLE_DESCRIPTION[role]}
          >
            {EVIDENCE_ROLE_LABEL[role]} view
          </Badge>
          {previewRole && !viewerRoleOverride && (
            <Badge
              variant="outline"
              className="text-[10px] font-mono uppercase tracking-wider border-amber-500/40 text-amber-300 bg-amber-500/5"
              title={`Simulating what a ${EVIDENCE_ROLE_LABEL[role]} would see. Your real access is ${EVIDENCE_ROLE_LABEL[derivedRole]}.`}
            >
              Preview mode
            </Badge>
          )}
        </div>

        {/* Preview-as switcher — always available so entrants can rehearse
            what each audience will see before publishing. */}
        {!viewerRoleOverride && (
          <nav
            id={controlsId}
            aria-label="Evidence drawer view controls"
            className="rounded-md border border-border/40 bg-muted/10 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Preview as
              </span>
              <div className="flex items-center gap-2">
                {previewRole && (
                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    aria-label={`Copy shareable link that opens this drawer as ${EVIDENCE_ROLE_LABEL[previewRole]}`}
                    title="Copy a link that opens this drawer in the current preview role"
                  >
                    <Link2 className="h-3 w-3" />
                    Share
                  </button>
                )}
                {previewRole && (
                  <button
                    type="button"
                    onClick={() => setPreviewRole(null)}
                    className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    aria-label="Reset to your actual role"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label="Preview evidence page as a different role"
              className="flex flex-wrap gap-1"
            >
              {(() => {
                const roles = ["entrant", "judge", "operator", "reader"] as const;
                const activeIndex = roles.indexOf(role);
                return roles.map((r, i) => {
                  const active = role === r;
                  const label = EVIDENCE_ROLE_LABEL[r];
                  const description = EVIDENCE_ROLE_DESCRIPTION[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`Preview as ${label} — ${description}`}
                      tabIndex={active || (activeIndex === -1 && i === 0) ? 0 : -1}
                      onClick={() => setPreviewRole(r)}
                      onKeyDown={(e) => {
                        const key = e.key;
                        let next = -1;
                        if (key === "ArrowRight" || key === "ArrowDown") {
                          next = (i + 1) % roles.length;
                        } else if (key === "ArrowLeft" || key === "ArrowUp") {
                          next = (i - 1 + roles.length) % roles.length;
                        } else if (key === "Home") {
                          next = 0;
                        } else if (key === "End") {
                          next = roles.length - 1;
                        }
                        if (next >= 0) {
                          e.preventDefault();
                          setPreviewRole(roles[next]);
                          const group = e.currentTarget.parentElement;
                          const btns = group?.querySelectorAll<HTMLButtonElement>(
                            'button[role="radio"]',
                          );
                          btns?.[next]?.focus();
                        }
                      }}
                      title={description}
                      className={cn(
                        "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border",
                      )}
                    >
                      {label}
                    </button>
                  );
                });
              })()}

            </div>
          </nav>
        )}

        {!viewerRoleOverride && previewTrail.length > 0 && (
          <div className="rounded-md border border-border/40 bg-muted/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setTrailOpen((v) => !v)}
              aria-expanded={trailOpen}
              aria-controls={`${titleId ?? "evidence-drawer"}-preview-trail`}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium text-foreground/90 hover:text-foreground"
            >
              <span className="flex items-center gap-1.5">
                {trailOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Preview audit trail
              </span>
              <Badge
                variant="outline"
                className="text-[9px] font-mono border-border/50 text-muted-foreground"
              >
                {previewTrail.length} view
                {previewTrail.length === 1 ? "" : "s"}
              </Badge>
            </button>
            {trailOpen && (
              <ol
                id={`${titleId ?? "evidence-drawer"}-preview-trail`}
                aria-label="Preview role switches this session"
                className="border-t border-border/40 bg-background/40 divide-y divide-border/30"
              >
                {previewTrail.map((e, i) => {
                  const t = new Date(e.at);
                  return (
                    <li
                      key={`${e.at}-${i}`}
                      className="px-2.5 py-1.5 text-[10.5px] flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {t.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] font-mono uppercase tracking-wider",
                          e.simulated
                            ? "border-amber-500/40 text-amber-300 bg-amber-500/5"
                            : "border-primary/40 text-primary bg-primary/5",
                        )}
                      >
                        {EVIDENCE_ROLE_LABEL[e.role]}
                        {e.simulated ? " · preview" : " · actual"}
                      </Badge>
                      <span className="text-muted-foreground">
                        {e.receiptsVisible} receipt
                        {e.receiptsVisible === 1 ? "" : "s"} visible
                        {e.receiptsRedacted > 0 &&
                          ` · ${e.receiptsRedacted} redacted`}
                      </span>
                      <span className="text-muted-foreground">
                        · {e.linksVisible} link
                        {e.linksVisible === 1 ? "" : "s"} visible
                        {e.linksRedacted > 0 &&
                          ` · ${e.linksRedacted} hidden`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {disclosure?.note && (
          <p className="text-[11px] text-muted-foreground">{disclosure.note}</p>
        )}
      </SheetHeader>

      <main
        id={mainId}
        tabIndex={-1}
        aria-label={`${title} evidence content`}
        className="mt-5 space-y-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <RoleActionBar
          role={role}
          isPreview={!!previewRole && !viewerRoleOverride}
          surfaceTitle={surfaceTitle}
        />
        <div>
          <h5 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Receipt trail
          </h5>
          <ReceiptTrail
            title="All receipts"
            entries={visibleReceipts}
            emptyMessage={
              isReader
                ? "Public readers do not see the internal receipt trail — only the disclosure banner and evidence hash summary."
                : "No receipts have been emitted for this evidence yet."
            }
            exportContext={{
              filename: `receipts-${title}`,
              title: `${title} — receipt trail`,
              subtitle: description,
              audience: EVIDENCE_ROLE_LABEL[role],
            }}
          />
          {!fullTrail && !isReader && receipts.length > 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              Hashes, correlation ids, and actor ids are visible to judges and
              operators only.
            </p>
          )}
          {isReader && receipts.length > 0 && (
            <p className="mt-2 text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              {receipts.length} internal receipt{receipts.length === 1 ? "" : "s"}{" "}
              hidden from public reader view.
            </p>
          )}
        </div>

        {fullTrail && visibleLinks.length > 0 && (
          <div>
            <h5 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Linked references
            </h5>
            <ul className="space-y-1.5">
              {visibleLinks.map((l, i) => (
                <li key={i}>
                  <LinkPreviewRow
                    link={l}
                    surfaceTitle={surfaceTitle}
                    viewerRole={role}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!fullTrail && linksRedactedCount > 0 && (
          <div className="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground inline-flex items-center gap-2">
            <EyeOff className="h-3 w-3" />
            {linksRedactedCount} linked reference
            {linksRedactedCount === 1 ? "" : "s"} hidden — visible to judges and
            operators only.
          </div>
        )}
      </main>
    </SheetContent>
  );
}

// ─── Role-scoped action bar ────────────────────────────────────────────────
//
// Shows only the actions the currently-selected role would actually perform
// on this evidence surface. Judges score + annotate, operators administer +
// annotate, entrants request a review, readers see nothing actionable. In
// preview mode the buttons acknowledge that they are a simulation and don't
// mutate anything — they just log to the evidence audit trail so operators
// can see which role was rehearsed.

interface RoleAction {
  id: string;
  label: string;
  icon: LucideIcon;
  variant?: "default" | "outline" | "secondary";
  auditEvent: import("@/lib/evidenceAudit").EvidenceAuditAction;
  previewMessage: string;
  liveMessage: string;
}

const ROLE_ACTIONS: Record<EvidenceViewerRole, RoleAction[]> = {
  judge: [
    {
      id: "score",
      label: "Score entry",
      icon: Gavel,
      variant: "default",
      auditEvent: "evidence.action.score",
      previewMessage: "Judges would open the scorecard from here.",
      liveMessage: "Opening scorecard…",
    },
    {
      id: "annotate",
      label: "Annotate",
      icon: MessageSquarePlus,
      variant: "outline",
      auditEvent: "evidence.action.annotate",
      previewMessage: "Judges would leave a private annotation here.",
      liveMessage: "Annotation drawer coming online…",
    },
  ],
  operator: [
    {
      id: "administer",
      label: "Administer",
      icon: Settings2,
      variant: "default",
      auditEvent: "evidence.action.administer",
      previewMessage:
        "Operators would open the admin console for this surface.",
      liveMessage: "Opening admin console…",
    },
    {
      id: "annotate",
      label: "Ops note",
      icon: MessageSquarePlus,
      variant: "outline",
      auditEvent: "evidence.action.annotate",
      previewMessage: "Operators would attach an internal ops note here.",
      liveMessage: "Ops note drawer coming online…",
    },
  ],
  entrant: [
    {
      id: "request_review",
      label: "Request review",
      icon: MessageSquarePlus,
      variant: "outline",
      auditEvent: "evidence.action.request_review",
      previewMessage:
        "Entrants would open a request-review dialog from this button.",
      liveMessage: "Opening request-review dialog…",
    },
  ],
  reader: [],
};

function RoleActionBar({
  role,
  isPreview,
  surfaceTitle,
}: {
  role: EvidenceViewerRole;
  isPreview: boolean;
  surfaceTitle: string;
}) {
  const actions = ROLE_ACTIONS[role];
  if (actions.length === 0) {
    return (
      <div
        aria-label={`${EVIDENCE_ROLE_LABEL[role]} actions`}
        className="rounded-md border border-dashed border-border/40 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground inline-flex items-center gap-2"
      >
        <EyeOff className="h-3 w-3" />
        {EVIDENCE_ROLE_LABEL[role]}s have no actions on this surface — this is a
        read-only view.
      </div>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label={`${EVIDENCE_ROLE_LABEL[role]} actions`}
      className="rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
          {EVIDENCE_ROLE_LABEL[role]} actions
        </span>
        {isPreview && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400/80">
            Preview — simulated
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={a.variant ?? "outline"}
              className="h-7 text-[11px]"
              onClick={() => {
                logEvidenceAudit(a.auditEvent, {
                  surfaceTitle,
                  viewerRole: role,
                  extra: { simulated: isPreview },
                });
                if (isPreview) {
                  toast.info(a.previewMessage, {
                    description: `You are viewing as ${EVIDENCE_ROLE_LABEL[role]} in preview mode.`,
                  });
                } else {
                  toast.success(a.liveMessage);
                }
              }}
            >
              <Icon className="h-3 w-3 mr-1" />
              {a.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

//
// Renders each `EvidenceLink` as an expandable row. Clicking "Preview" fetches
// public metadata for the reference so operators can inspect PR titles, spec
// contents, or commit messages without leaving the evidence drawer. External
// navigation stays available via the trailing icon link as a fallback.

interface GithubPreview {
  kind: "pr" | "issue" | "commit";
  title: string;
  state?: string;
  author?: string | null;
  timestamp?: string | null;
  body?: string | null;
  url: string;
}

interface MarkdownPreview {
  kind: "spec";
  text: string;
  url: string;
}

type FetchedPreview = GithubPreview | MarkdownPreview | null;

function parseGithubUrl(url: string):
  | { owner: string; repo: string; kind: "pr" | "issue" | "commit"; ref: string }
  | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, repo, type, ref] = parts;
    if (type === "pull") return { owner, repo, kind: "pr", ref };
    if (type === "issues") return { owner, repo, kind: "issue", ref };
    if (type === "commit") return { owner, repo, kind: "commit", ref };
    return null;
  } catch {
    return null;
  }
}

async function fetchPreview(
  link: EvidenceLink,
  signal?: AbortSignal,
): Promise<FetchedPreview> {
  const gh = parseGithubUrl(link.url);
  if (gh) {
    const base = `https://api.github.com/repos/${gh.owner}/${gh.repo}`;
    let apiUrl = "";
    if (gh.kind === "pr") apiUrl = `${base}/pulls/${gh.ref}`;
    else if (gh.kind === "issue") apiUrl = `${base}/issues/${gh.ref}`;
    else apiUrl = `${base}/commits/${gh.ref}`;

    const res = await cachedFetch(apiUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data: any = await res.json();
    if (gh.kind === "commit") {
      return {
        kind: "commit",
        title: (data?.commit?.message ?? "").split("\n")[0] || link.label,
        author: data?.commit?.author?.name ?? data?.author?.login ?? null,
        timestamp: data?.commit?.author?.date ?? null,
        body:
          (data?.commit?.message ?? "").split("\n").slice(1).join("\n").trim() ||
          null,
        url: link.url,
      };
    }
    return {
      kind: gh.kind,
      title: data?.title ?? link.label,
      state: data?.state ?? undefined,
      author: data?.user?.login ?? null,
      timestamp: data?.created_at ?? null,
      body: data?.body ?? null,
      url: link.url,
    };
  }

  // Spec / doc: attempt to fetch raw markdown text.
  const kind = link.kind ?? inferLinkKind(link.url);
  if (kind === "spec" || kind === "doc") {
    const res = await cachedFetch(link.url, {
      headers: { Accept: "text/plain" },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!/text|json|markdown/i.test(ct)) throw new Error("not_text");
    const text = await res.text();
    return { kind: "spec", text: text.slice(0, 4000), url: link.url };
  }

  throw new Error("preview_unavailable");
}


function LinkPreviewRow({
  link,
  surfaceTitle,
  viewerRole,
}: {
  link: EvidenceLink;
  surfaceTitle: string;
  viewerRole: EvidenceViewerRole;
}) {
  const kind = link.kind ?? inferLinkKind(link.url);
  const meta = LINK_META[kind];
  const KindIcon = meta.icon;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<FetchedPreview>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const reactId = useId();
  const panelId = `evidence-link-panel-${reactId}`;
  const errorId = `evidence-link-error-${reactId}`;
  // Track the in-flight AbortController so unmount, collapse, and scroll-away
  // can each cancel a pending request without racing a stale response into
  // state. Also track whether the row is currently in-viewport — an out-of-
  // viewport row aborts an active fetch and won't auto-refetch until it
  // scrolls back into view.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [visible, setVisible] = useState(true);

  // Reveal = one audit row per expand. This is the "restricted-view" event
  // that the EvidenceAuditLogPanel surfaces to admins.
  useEffect(() => {
    if (!open) {
      announce(`${link.label} preview collapsed`);
      return;
    }
    logEvidenceAudit("evidence.link_preview_reveal", {
      surfaceTitle,
      viewerRole,
      extra: { link_kind: kind, link_label: link.label, link_url: link.url },
    });
    announce(`${link.label} preview expanded, loading…`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runFetch = useCallback(() => {
    // Abort any previous in-flight request before starting a new one so a
    // late resolver from the prior attempt can't overwrite fresh state.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    fetchPreview(link, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        setPreview(p);
        announce(`${link.label} preview ready`);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        // DOMException("AbortError") can slip through when fetch itself
        // rejects synchronously on the signal — treat it as a cancel.
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg =
          e instanceof Error && e.message ? e.message : "preview_unavailable";
        setError(msg);
        announce(`${link.label} preview failed: ${msg}`, "assertive");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [link]);

  useEffect(() => {
    // Skip when the panel is closed or scrolled off-screen; abort any active
    // fetch on those transitions so we don't burn bandwidth on unseen rows.
    if (!open || !visible) {
      if (loading) {
        abortRef.current?.abort();
        setLoading(false);
      }
      return;
    }
    if (preview || loading) return;
    return runFetch();
  }, [open, visible, preview, loading, runFetch, retryCount]);

  // Unmount cleanup — belt & suspenders on top of the effect cleanup above,
  // so a parent that unmounts LinkPreviewRow mid-fetch always cancels the
  // outstanding request.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Track viewport visibility with IntersectionObserver. Rows scrolled far
  // outside the drawer viewport cancel in-flight fetches; scrolling back in
  // resumes the fetch via the effect above.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisible(entry.isIntersecting);
        }
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleRetry = () => {
    abortRef.current?.abort();
    setPreview(null);
    setError(null);
    setRetryCount((n) => n + 1);
    announce(`Retrying ${link.label} preview…`);
  };


  return (
    <div ref={containerRef} className="rounded-md border border-border/40 bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Hide" : "Show"} inline preview for ${link.label}`}
          className="group flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
            />
          ) : (
            <ChevronRight
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
            />
          )}
          <KindIcon
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
          />
          <Badge
            variant="outline"
            className="text-[10px] font-mono border-border/40"
          >
            {meta.label}
          </Badge>
          <span className="truncate flex-1">{link.label}</span>
        </button>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${link.label} in a new tab`}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={`Preview of ${link.label}`}
          className="border-t border-border/40 px-3 py-2.5 text-[11px] space-y-2 bg-muted/5"
        >

          {loading && (
            <div
              role="status"
              aria-live="polite"
              aria-label={`Loading ${link.label} preview`}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Loading preview…
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <span className="sr-only">Fetching inline preview for {link.label}.</span>
            </div>
          )}

          {!loading && error && (
            <div
              role="alert"
              aria-describedby={errorId}
              className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 space-y-2"
            >
              <div className="flex items-start gap-2 text-[11px] text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <div id={errorId} className="min-w-0 flex-1">
                  <div className="font-semibold">Inline preview unavailable</div>
                  <div className="text-[10px] font-mono text-destructive/80 break-all mt-0.5">
                    {error}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Retry the request or open the reference in a new tab.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleRetry}
                  aria-label={`Retry loading preview for ${link.label}`}
                  className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Retry
                </Button>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border/40 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open ${link.label} in a new tab`}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  Open link
                </a>
              </div>
            </div>
          )}


          {!loading && preview && preview.kind !== "spec" && (
            <div className="space-y-1.5">
              <div className="font-medium text-foreground/90">
                {preview.title}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
                {preview.state && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono uppercase",
                      preview.state === "open"
                        ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                        : preview.state === "closed"
                          ? "border-red-500/40 text-red-300 bg-red-500/5"
                          : "border-border/40 text-muted-foreground",
                    )}
                  >
                    {preview.state}
                  </Badge>
                )}
                {preview.author && <span>by {preview.author}</span>}
                {preview.timestamp && (
                  <span>{new Date(preview.timestamp).toLocaleString()}</span>
                )}
              </div>
              {preview.body && (
                <pre className="whitespace-pre-wrap font-sans text-[11px] text-muted-foreground max-h-64 overflow-y-auto">
                  {preview.body.slice(0, 2000)}
                  {preview.body.length > 2000 ? "\n…" : ""}
                </pre>
              )}
            </div>
          )}

          {!loading && preview && preview.kind === "spec" && (
            <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted-foreground max-h-72 overflow-y-auto">
              {preview.text}
              {preview.text.length >= 4000 ? "\n…" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

