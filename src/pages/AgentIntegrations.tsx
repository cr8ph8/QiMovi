import { useEffect, useMemo, useRef, useState } from "react";
import manifest from "../../.lovable/mcp/manifest.json";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle2, XCircle, RefreshCw, Wrench, ShieldCheck, Copy, PlayCircle, FileText, BookOpen, AlertTriangle, Lock, WifiOff, Mail, LogIn, SearchX, FilePlus, Loader2, Globe, HelpCircle } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { getRlsScope } from "@/lib/mcp/rlsScopes";

type Status = "checking" | "online" | "offline";

interface McpTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export default function AgentIntegrations() {
  const { user, session, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<Status>("checking");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tools = useMemo<McpTool[]>(() => (manifest as any)?.mcp?.tools ?? [], []);
  const endpoint = `${SUPABASE_URL}${manifest.path}`;
  const serverName = (manifest as any)?.mcp?.server?.name ?? "mcp";
  const serverTitle = (manifest as any)?.mcp?.server?.title ?? "MCP Server";
  const serverVersion = (manifest as any)?.mcp?.server?.version ?? "0.0.0";

  async function ping() {
    setStatus("checking");
    setError(null);
    try {
      const res = await fetch(`${endpoint}/.well-known/oauth-protected-resource`, {
        method: "GET",
      });
      if (res.ok || res.status === 401 || res.status === 404) {
        // 200 for resource metadata, 401/404 also mean the function is reachable
        setStatus("online");
      } else {
        setStatus("offline");
        setError(`HTTP ${res.status}`);
      }
    } catch (e: any) {
      setStatus("offline");
      setError(e?.message ?? "Network error");
    } finally {
      setLastSync(new Date());
    }
  }

  useEffect(() => {
    void ping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  }

  return (
    <div className="container mx-auto max-w-5xl py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Agent Integrations</h1>
        <p className="text-muted-foreground">
          Connect AI assistants (ChatGPT, Claude, Cursor, Codex) to your CanIScreenwrite account via the
          Model Context Protocol (MCP). Signed-in agents can read your entries, scorecards, and active competitions.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              {serverTitle}
              <Badge variant="outline">v{serverVersion}</Badge>
            </CardTitle>
            <CardDescription>Server name: <code>{serverName}</code></CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {status === "checking" ? (
              <Badge variant="secondary">Checking…</Badge>
            ) : status === "online" ? (
              <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Online</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Offline</Badge>
            )}
            <Button size="sm" variant="outline" onClick={ping} disabled={status === "checking"}>
              <RefreshCw className={`h-4 w-4 mr-1 ${status === "checking" ? "animate-spin" : ""}`} />
              Recheck
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusRow label="Signed-in user">
              {authLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : user ? (
                <span className="text-sm">{user.email ?? user.id}</span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Not signed in — connect from your assistant to grant access.
                </span>
              )}
            </StatusRow>
            <StatusRow label="Session token">
              <span className="text-sm text-muted-foreground">
                {session ? "Active — OAuth clients will authenticate as you" : "None"}
              </span>
            </StatusRow>
            <StatusRow label="Last sync">
              <span className="text-sm text-muted-foreground">
                {lastSync ? lastSync.toLocaleString() : "—"}
              </span>
            </StatusRow>
            <StatusRow label="Auth">
              <span className="text-sm text-muted-foreground">
                OAuth 2.1 (Supabase issuer)
              </span>
            </StatusRow>
          </div>

          {error && (
            <p className="text-sm text-destructive">Status check error: {error}</p>
          )}

          <div className="rounded-md border bg-muted/40 p-3 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connection URL
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all">{endpoint}</code>
              <Button size="sm" variant="ghost" onClick={() => copy(endpoint, "URL")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this into your assistant's MCP connector. It will trigger the OAuth flow and prompt you
              to approve access at <code>/.lovable/oauth/consent</code>.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Available tools
            <Badge variant="outline">{tools.length}</Badge>
          </CardTitle>
          <CardDescription>
            These tools are exposed to any connected assistant. All calls run as the signed-in user and are
            filtered by Row Level Security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tools.length === 0 && (
            <p className="text-sm text-muted-foreground">No tools advertised.</p>
          )}
          {tools.map((tool) => (
            <div key={tool.name} className="rounded-md border p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{tool.title ?? tool.name}</div>
                    <RlsScopeBadge toolName={tool.name} />
                  </div>
                  <code className="text-xs text-muted-foreground">{tool.name}</code>
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                  {tool.annotations?.readOnlyHint && <Badge variant="secondary">read-only</Badge>}
                  {tool.annotations?.idempotentHint && <Badge variant="secondary">idempotent</Badge>}
                  {tool.annotations?.openWorldHint === false && <Badge variant="outline">scoped</Badge>}
                  {tool.annotations?.openWorldHint && <Badge variant="outline">open world</Badge>}
                </div>
              </div>
              {tool.description && (
                <p className="text-sm text-muted-foreground">{tool.description}</p>
              )}
            </div>
          ))}
          <RlsScopeLegend />
        </CardContent>
      </Card>

      <TryToolsCard signedIn={!!user} />

      <HelpCard />
    </div>
  );
}

interface ToolScope {
  /** Short scope label (e.g. "read:own-entries"). */
  label: string;
  /** What granting this scope enables for the entrant, in plain language. */
  enables: string;
  /** Whether the tool refuses to run without this scope. */
  required: boolean;
}
interface ToolHelp {
  name: string;
  title: string;
  purpose: string;
  auth: string;
  scopes: ToolScope[];
  input: unknown;
  output: unknown;
}

const TOOL_HELP: ToolHelp[] = [
  {
    name: "list_my_entries",
    title: "List my screenplay entries",
    purpose:
      "Return the signed-in writer's submissions ordered by newest first. Use to let the assistant pick an entry to inspect or discuss.",
    auth: "OAuth (Supabase issuer). The tool derives user_id from the verified access token — never from tool input.",
    scopes: [
      {
        label: "read:own-entries",
        enables: "Lets the assistant list your own submissions (title, status, page count, created date). No other user's entries are visible.",
        required: true,
      },
      {
        label: "auth:oauth-session",
        enables: "Derives your user id from the verified access token so RLS filters entries to auth.uid(). Never accepts user_id as input.",
        required: true,
      },
      {
        label: "readonly:closed-world",
        enables: "Tool is read-only and idempotent — safe to call repeatedly, never writes or mutates entries.",
        required: false,
      },
    ],
    input: { limit: 10, status: "submitted" },
    output: {
      entries: [
        {
          id: "8c9e…-uuid",
          title: "The Cartographer",
          genre: "Drama",
          logline: "A cartographer maps a city that keeps forgetting itself.",
          status: "submitted",
          length_category: "short",
          page_count: 12,
          created_at: "2026-06-14T09:22:11Z",
        },
      ],
    },
  },
  {
    name: "get_entry_scorecard",
    title: "Get entry scorecard",
    purpose:
      "Fetch a single entry the caller can read, including all score rows (narrative, character, dialogue, structure, theme, emotion, total, feedback).",
    auth: "OAuth (Supabase issuer). RLS on entries and scores enforces access — a foreign entry_id returns 'not accessible'.",
    scopes: [
      {
        label: "read:own-entries",
        enables: "Fetches the entry row (title, status, page count, author) when RLS says you can read it.",
        required: true,
      },
      {
        label: "read:own-scores",
        enables: "Includes all score rows (narrative, character, dialogue, structure, theme, emotion, total, feedback) for the entry.",
        required: true,
      },
      {
        label: "auth:oauth-session",
        enables: "Enforces the entry_id belongs to you or was shared with you; a foreign entry_id returns 'not accessible'.",
        required: true,
      },
      {
        label: "readonly:closed-world",
        enables: "Read-only and idempotent — never mutates scores or entries.",
        required: false,
      },
    ],
    input: { entry_id: "8c9e…-uuid" },
    output: {
      entry: {
        id: "8c9e…-uuid",
        title: "The Cartographer",
        status: "submitted",
        page_count: 12,
        scores: [
          {
            total_score: 82,
            narrative: 84,
            character_score: 80,
            dialogue: 79,
            structure: 85,
            theme: 83,
            emotion: 81,
            feedback: "Strong spine, second act needs a sharper reversal.",
            created_at: "2026-06-14T09:31:44Z",
            superseded_at: null,
          },
        ],
      },
    },
  },
  {
    name: "list_competitions",
    title: "List active competitions",
    purpose:
      "Return active competitions with title, length category, deadline, and prize pool so an agent can suggest where to submit.",
    auth: "None required — public data. Works even when the caller is not signed in.",
    scopes: [
      {
        label: "read:public-competitions",
        enables: "Lists active competitions (title, length category, deadline, prize pool) so an entrant can decide where to submit.",
        required: true,
      },
      {
        label: "no-auth",
        enables: "Works even when the caller is signed out — no user context is used.",
        required: false,
      },
      {
        label: "readonly:open-world",
        enables: "Read-only and idempotent; safe to call from any assistant.",
        required: false,
      },
    ],
    input: { limit: 5 },
    output: {
      competitions: [
        {
          id: "c1f2…-uuid",
          title: "Micro Short — Summer 2026",
          length_category: "micro",
          status: "active",
          submission_deadline: "2026-08-31T23:59:00Z",
          prize_pool: 5000,
        },
      ],
    },
  },
];

function HelpCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          How each tool works
        </CardTitle>
        <CardDescription>
          Reference for anyone wiring an assistant to CanIScreenwrite — what each MCP tool does,
          the auth it requires, the row-level scopes it reads, and a full request / response example.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Accordion type="multiple" className="w-full">
          {TOOL_HELP.map((t) => (
            <AccordionItem key={t.name} value={t.name}>
              <AccordionTrigger className="text-left">
                <div className="flex flex-col items-start">
                  <span className="font-medium">{t.title}</span>
                  <code className="text-xs text-muted-foreground">{t.name}</code>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Purpose
                  </div>
                  <p className="text-sm">{t.purpose}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Auth
                  </div>
                  <p className="text-sm">{t.auth}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Required scopes
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Each scope below is what the tool needs to serve an entrant. Required scopes
                    are enforced server-side by RLS and the OAuth verifier — no way to opt out.
                  </p>
                  <ul className="space-y-2">
                    {t.scopes.map((s) => (
                      <li key={s.label} className="flex items-start gap-2 text-sm">
                        <CheckCircle2
                          className={`h-4 w-4 mt-0.5 shrink-0 ${
                            s.required ? "text-primary" : "text-muted-foreground"
                          }`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="text-xs font-mono">{s.label}</code>
                            <Badge
                              variant={s.required ? "default" : "outline"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {s.required ? "Required" : "Optional guarantee"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            <span className="text-foreground/80">Enables for entrants: </span>
                            {s.enables}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Example input
                    </div>
                    <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto">
                      {JSON.stringify(t.input, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Example output
                    </div>
                    <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto">
                      {JSON.stringify(t.output, null, 2)}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">General auth model.</strong> Tools that touch user data verify
            the Supabase access token, extract the user id from its <code>sub</code> claim, and forward the
            token to PostgREST so RLS runs as the caller. Never pass <code>user_id</code> as a tool input.
          </p>
          <p>
            <strong className="text-foreground">Errors.</strong> Failures return <code>{`{ isError: true }`}</code>{" "}
            with a text message — assistants should surface these instead of retrying.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Categorized MCP tool error — mirrors the GateFailure shape the server returns. */
type ToolErrorKind = "auth" | "permission" | "not_found" | "network" | "rate_limit" | "unknown";
interface ToolError {
  kind: ToolErrorKind;
  title: string;
  body: string;
  raw?: string;
  canRetry: boolean;
  canContactAdmin: boolean;
}

const SUPPORT_EMAIL = "support@caniscreenwrite.com";

function classifyToolError(err: unknown): ToolError {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : (err as { message?: string } | null)?.message ?? String(err ?? "");
  const code = (err as { code?: string } | null)?.code ?? "";
  const status = (err as { status?: number } | null)?.status ?? 0;
  const m = raw.toLowerCase();

  if (
    m.includes("not authenticated") ||
    m.includes("jwt") ||
    m.includes("sign in") ||
    status === 401
  ) {
    return {
      kind: "auth",
      title: "You're signed out",
      body: "Sign in again to run this tool. Connected assistants will be prompted to reauthorize.",
      raw,
      canRetry: true,
      canContactAdmin: false,
    };
  }
  if (
    m.includes("restricted to") ||
    m.includes("not an entrant") ||
    m.includes("permission") ||
    m.includes("row-level security") ||
    m.includes("rls") ||
    code === "42501" ||
    status === 403
  ) {
    return {
      kind: "permission",
      title: "You don't have access to this tool",
      body:
        "This tool requires a role your account doesn't currently hold (for example: entrant, judge, or admin). If you believe this is a mistake, contact an admin.",
      raw,
      canRetry: false,
      canContactAdmin: true,
    };
  }
  if (m.includes("not found") || m.includes("not accessible") || status === 404) {
    return {
      kind: "not_found",
      title: "Nothing to show",
      body: "The record isn't visible to your account, or it no longer exists.",
      raw,
      canRetry: true,
      canContactAdmin: false,
    };
  }
  if (m.includes("rate") && m.includes("limit")) {
    return {
      kind: "rate_limit",
      title: "Rate limit hit",
      body: "Too many requests in a short window. Wait a moment and try again.",
      raw,
      canRetry: true,
      canContactAdmin: false,
    };
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("timed out")
  ) {
    return {
      kind: "network",
      title: "Network problem",
      body: "The request didn't reach the server. Check your connection and retry.",
      raw,
      canRetry: true,
      canContactAdmin: false,
    };
  }
  return {
    kind: "unknown",
    title: "Something went wrong",
    body: "The tool returned an unexpected error. You can retry, or contact an admin if it keeps happening.",
    raw,
    canRetry: true,
    canContactAdmin: true,
  };
}

function ToolErrorAlert({
  toolName,
  error,
  onRetry,
}: {
  toolName: string;
  error: ToolError;
  onRetry?: () => void;
}) {
  const Icon =
    error.kind === "auth"
      ? LogIn
      : error.kind === "permission"
        ? Lock
        : error.kind === "network"
          ? WifiOff
          : error.kind === "not_found"
            ? SearchX
            : AlertTriangle;
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `MCP tool access: ${toolName}`,
  )}&body=${encodeURIComponent(
    `Tool: ${toolName}\nCategory: ${error.kind}\nMessage: ${error.raw ?? error.title}\n\nPlease grant me the role I need to use this tool.`,
  )}`;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
        <div className="space-y-1 min-w-0">
          <div className="text-sm font-medium">{error.title}</div>
          <p className="text-xs text-muted-foreground">{error.body}</p>
        </div>
      </div>
      {error.raw && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all">{error.raw}</pre>
        </details>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {error.canRetry && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Try again
          </Button>
        )}
        {error.canContactAdmin && (
          <Button size="sm" variant="ghost" asChild>
            <a href={mailto}>
              <Mail className="h-3.5 w-3.5 mr-1" />
              Contact admin
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function RlsScopeBadge({ toolName }: { toolName: string }) {
  const scope = getRlsScope(toolName);
  // Icon + text + pattern so meaning survives color-blindness and greyscale.
  // Solid ring (●) = auth-required, hollow ring (○) = public, warning (△) = unknown.
  const map = {
    requireEntrant: { Icon: ShieldCheck, glyph: "●", ring: "ring-1 ring-inset ring-primary/40" },
    requireJudge:   { Icon: ShieldCheck, glyph: "●", ring: "ring-1 ring-inset ring-primary/40" },
    requireAdmin:   { Icon: Lock,        glyph: "●", ring: "ring-1 ring-inset ring-foreground/40" },
    none:           { Icon: Globe,       glyph: "○", ring: "ring-1 ring-inset ring-muted-foreground/40 border-dashed" },
  } as const;
  const fallback = { Icon: AlertTriangle, glyph: "△", ring: "ring-1 ring-inset ring-destructive/50" };
  const { Icon, glyph, ring } = (map as any)[scope.gate] ?? fallback;
  const ariaLabel = `RLS scope: ${scope.label}. ${scope.description}`;
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={scope.variant}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0 ${ring}`}
            aria-label={ariaLabel}
            role="img"
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span aria-hidden className="sr-only sm:not-sr-only">{glyph}</span>
            <span>{scope.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4} className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{scope.label}</p>
            <p className="text-xs text-muted-foreground">{scope.description}</p>
            <p className="text-xs text-muted-foreground">
              {scope.gate === "none"
                ? "Works without signing in. No RLS user filter is applied."
                : scope.gate === "requireEntrant"
                  ? "Requires an entrant role. RLS filters rows to your auth.uid()."
                  : scope.gate === "requireAdmin"
                    ? "Requires an admin role. RLS restricts access to platform administrators."
                    : scope.gate === "requireJudge"
                      ? "Requires a judge role. RLS limits access to assigned judges."
                      : "Unknown scope — default RLS enforcement applies."}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RlsScopeLegend() {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        RLS scope legend
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0 ring-1 ring-inset ring-primary/40">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              <span>Entrant only</span>
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Requires an entrant role. RLS filters rows to your auth.uid() so only your own records are returned.
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0 ring-1 ring-inset ring-foreground/40">
              <Lock className="h-3 w-3" aria-hidden />
              <span>Admin only</span>
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Restricted to platform administrators. RLS checks an admin role before serving any rows.
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0 ring-1 ring-inset ring-muted-foreground/40 border-dashed">
              <Globe className="h-3 w-3" aria-hidden />
              <span>Public</span>
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Works without signing in. No RLS user filter is applied; only public rows are served.
          </p>
        </div>
      </div>
    </div>
  );
}

interface EntryRow {
  id: string;
  title: string | null;
  status: string | null;
  genre: string | null;
  length_category: string | null;
  page_count: number | null;
  created_at: string;
}

function TryToolsCard({ signedIn }: { signedIn: boolean }) {
  const [entrantStatus, setEntrantStatus] = useState<"checking" | "yes" | "no">("checking");
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<ToolError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<any>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState<ToolError | null>(null);
  const [confirmTool, setConfirmTool] = useState<string | null>(null);
  const [confirmEntryId, setConfirmEntryId] = useState<string | null>(null);
  const entriesReqRef = useRef(0);
  const scorecardReqRef = useRef(0);

  async function runListMyEntries() {
    const reqId = ++entriesReqRef.current;
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (reqId !== entriesReqRef.current) return;
      if (!userId) {
        setEntriesError(classifyToolError("Not authenticated. Sign in to use writer tools."));
        setEntriesLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("entries")
        .select("id, title, genre, status, length_category, page_count, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (reqId !== entriesReqRef.current) return;
      if (error) setEntriesError(classifyToolError(error));
      else setEntries((data ?? []) as EntryRow[]);
    } catch (e) {
      if (reqId !== entriesReqRef.current) return;
      setEntriesError(classifyToolError(e));
    } finally {
      if (reqId === entriesReqRef.current) setEntriesLoading(false);
    }
  }

  async function runGetEntryScorecard(entryId: string) {
    const reqId = ++scorecardReqRef.current;
    setSelectedId(entryId);
    setScorecardLoading(true);
    setScorecardError(null);
    // Keep previous scorecard visible until the new one resolves to avoid layout jump.
    try {
      const { data, error } = await supabase
        .from("entries")
        .select(
          "id, title, genre, logline, status, length_category, page_count, author, created_at, scores(total_score, narrative, character_score, dialogue, structure, theme, emotion, feedback, created_at, superseded_at)",
        )
        .eq("id", entryId)
        .maybeSingle();
      if (reqId !== scorecardReqRef.current) return;
      if (error) {
        setScorecardError(classifyToolError(error));
        setScorecard(null);
      } else if (!data) {
        setScorecardError(classifyToolError("Entry not found or not accessible."));
        setScorecard(null);
      } else {
        setScorecard(data);
      }
    } catch (e) {
      if (reqId !== scorecardReqRef.current) return;
      setScorecardError(classifyToolError(e));
      setScorecard(null);
    } finally {
      if (reqId === scorecardReqRef.current) setScorecardLoading(false);
    }
  }


  useEffect(() => {
    let active = true;
    (async () => {
      if (!signedIn) {
        setEntrantStatus("no");
        return;
      }
      setEntrantStatus("checking");
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) {
        if (active) setEntrantStatus("no");
        return;
      }
      // Entrant = any authenticated user with an assigned app_role
      // (writers get 'user'; admin/judge/moderator pass through for preview).
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .limit(1);
      if (!active) return;
      setEntrantStatus(!error && (data?.length ?? 0) > 0 ? "yes" : "no");
    })();
    return () => {
      active = false;
    };
  }, [signedIn]);

  const isEntrant = entrantStatus === "yes";
  const checkingEntrant = entrantStatus === "checking";

  /** Does the caller's role satisfy the scope registered for this tool? */
  function hasAccess(toolName: string): boolean {
    const gate = getRlsScope(toolName).gate;
    if (gate === "none") return true;
    if (!signedIn) return false;
    if (gate === "requireEntrant") return isEntrant;
    // requireAdmin / requireJudge / unknown → deny in preview until a
    // matching role check is wired up here.
    return false;
  }

  function accessMessage(toolName: string): string {
    const scope = getRlsScope(toolName);
    if (!signedIn) return "Sign in to run this tool.";
    if (checkingEntrant) return "Checking your role…";
    return `${scope.label} access required to run this tool.`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5" />
          Try tools
        </CardTitle>
        <CardDescription>
          Run the same read-only queries a connected agent would run — scoped to your account by RLS.
          This is a live preview of what <code>list_my_entries</code> and <code>get_entry_scorecard</code> return.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="font-medium">list_my_entries</div>
                <RlsScopeBadge toolName="list_my_entries" />
              </div>
              <p className="text-xs text-muted-foreground">Fetch your latest 25 entries.</p>
            </div>
            {(() => {
              const allowed = hasAccess("list_my_entries");
              const disabled = entriesLoading || !allowed || checkingEntrant;
              return (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirmEntryId(null);
                      setConfirmTool("list_my_entries");
                    }}
                    disabled={disabled}
                    aria-busy={entriesLoading}
                    aria-disabled={disabled}
                    title={!allowed ? accessMessage("list_my_entries") : undefined}
                  >
                    {entriesLoading ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
                    ) : !allowed ? (
                      <Lock className="h-4 w-4 mr-1" aria-hidden />
                    ) : (
                      <PlayCircle className="h-4 w-4 mr-1" aria-hidden />
                    )}
                    {entriesLoading ? "Running…" : entries ? "Re-run" : "Run"}
                  </Button>
                  {!allowed && !checkingEntrant && (
                    <span className="text-[11px] text-muted-foreground" role="note">
                      {accessMessage("list_my_entries")}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
          {signedIn && checkingEntrant && (
            <Skeleton className="h-16 w-full" />
          )}
          {signedIn && !checkingEntrant && !isEntrant && (
            <div
              role="status"
              className="rounded-md border border-dashed p-3 flex items-start gap-2"
            >
              <Lock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium">Entrant access required</div>
                <p className="text-xs text-muted-foreground">
                  Only accounts with an entrant role can list their entries or open a scorecard.
                  Submit an entry to become an entrant, or contact an admin if you believe this is a mistake.
                </p>
                <div className="pt-1">
                  <Button size="sm" variant="ghost" asChild>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                        "Request entrant access",
                      )}`}
                    >
                      <Mail className="h-3.5 w-3.5 mr-1" />
                      Contact admin
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}
          {entriesError && (
            <ToolErrorAlert
              toolName="list_my_entries"
              error={entriesError}
              onRetry={runListMyEntries}
            />
          )}
          {entriesLoading && !entries && (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {entries && entries.length === 0 && !entriesLoading && (
            <EmptyEntriesState />
          )}
          {entries && entries.length > 0 && (
            <div
              className={`rounded-md border divide-y transition-opacity ${entriesLoading ? "opacity-60" : ""}`}
              aria-busy={entriesLoading}
            >
              {entries.map((e) => {
                const isRowLoading = scorecardLoading && selectedId === e.id;
                const isRowSelected = selectedId === e.id;
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{e.title ?? "Untitled"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[e.status, e.genre, e.length_category, e.page_count ? `${e.page_count} pp` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {(() => {
                      const allowed = hasAccess("get_entry_scorecard");
                      const disabled = scorecardLoading || !allowed;
                      return (
                        <Button
                          size="sm"
                          variant={isRowSelected ? "default" : "outline"}
                          onClick={() => {
                            setConfirmEntryId(e.id);
                            setConfirmTool("get_entry_scorecard");
                          }}
                          disabled={disabled}
                          aria-busy={isRowLoading}
                          aria-disabled={disabled}
                          title={!allowed ? accessMessage("get_entry_scorecard") : undefined}
                          className="min-w-[110px] justify-center"
                        >
                          {isRowLoading ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
                          ) : !allowed ? (
                            <Lock className="h-4 w-4 mr-1" aria-hidden />
                          ) : (
                            <FileText className="h-4 w-4 mr-1" aria-hidden />
                          )}
                          {isRowLoading ? "Loading…" : "Scorecard"}
                        </Button>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {(selectedId || scorecardLoading || scorecardError || scorecard) && (
          <section className="space-y-2" aria-live="polite" aria-busy={scorecardLoading}>
            <div className="flex items-center gap-2">
              <div className="font-medium">get_entry_scorecard</div>
              <RlsScopeBadge toolName="get_entry_scorecard" />
              {scorecardLoading && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Loading scorecard…
                </span>
              )}
            </div>
            <div className="relative min-h-[10rem]">
              {scorecardLoading && !scorecard && !scorecardError && (
                <Skeleton className="h-40 w-full" />
              )}
              {scorecardError && selectedId && !scorecardLoading && (
                <ToolErrorAlert
                  toolName="get_entry_scorecard"
                  error={scorecardError}
                  onRetry={() => runGetEntryScorecard(selectedId)}
                />
              )}
              {scorecard && (
                <pre
                  className={`rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto max-h-96 transition-opacity ${scorecardLoading ? "opacity-50" : ""}`}
                >
                  {JSON.stringify(scorecard, null, 2)}
                </pre>
              )}
            </div>
          </section>
        )}
        <RunConfirmModal
          toolName={confirmTool}
          entryId={confirmEntryId}
          open={!!confirmTool}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmTool(null);
              setConfirmEntryId(null);
            }
          }}
          onConfirm={() => {
            const tool = confirmTool;
            const id = confirmEntryId;
            setConfirmTool(null);
            setConfirmEntryId(null);
            if (tool === "list_my_entries") {
              void runListMyEntries();
            } else if (tool === "get_entry_scorecard" && id) {
              void runGetEntryScorecard(id);
            }
          }}
          signedIn={signedIn}
          checkingEntrant={checkingEntrant}
          isEntrant={isEntrant}
        />
      </CardContent>
    </Card>
  );
}

interface RunConfirmModalProps {
  toolName: string | null;
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  signedIn: boolean;
  checkingEntrant: boolean;
  isEntrant: boolean;
}

function RunConfirmModal({
  toolName,
  entryId,
  open,
  onOpenChange,
  onConfirm,
  signedIn,
  checkingEntrant,
  isEntrant,
}: RunConfirmModalProps) {
  const displayName = toolName ?? "this tool";
  const tool = toolName ? TOOL_HELP.find((t) => t.name === toolName) : undefined;
  const scope = toolName ? getRlsScope(toolName) : null;

  function hasAccess(): boolean {
    if (!scope) return false;
    if (scope.gate === "none") return true;
    if (!signedIn) return false;
    if (scope.gate === "requireEntrant") return isEntrant;
    return false;
  }

  function accessMessage(): string {
    if (!scope) return "No scope information.";
    if (!signedIn) return "Sign in to run this tool.";
    if (checkingEntrant) return "Checking your role…";
    return `${scope.label} access required to run this tool.`;
  }

  const allowed = hasAccess();
  const message = accessMessage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5" />
            Run {displayName}?
          </DialogTitle>
          <DialogDescription>
            This will execute a live MCP tool call scoped to your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {tool && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Purpose
              </div>
              <p className="text-sm text-foreground/90">{tool.purpose}</p>
            </div>
          )}

          {scope && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                RLS scope
              </div>
              <div className="flex items-center gap-3">
                <RlsScopeBadge toolName={toolName!} />
                <span className="text-sm text-muted-foreground">{scope.description}</span>
              </div>
            </div>
          )}

          {!allowed && (
            <div
              role="status"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2"
            >
              <Lock className="h-4 w-4 mt-0.5 text-destructive shrink-0" aria-hidden />
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium">Access required</div>
                <p className="text-xs text-muted-foreground">{message}</p>
              </div>
            </div>
          )}

          {entryId && (
            <div className="text-xs text-muted-foreground">
              Entry ID: <code className="text-foreground/80">{entryId}</code>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!allowed || checkingEntrant}>
            {checkingEntrant ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />
            ) : !allowed ? (
              <Lock className="h-4 w-4 mr-1" aria-hidden />
            ) : (
              <PlayCircle className="h-4 w-4 mr-1" aria-hidden />
            )}
            {checkingEntrant ? "Checking…" : "Confirm run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyEntriesState() {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <FilePlus className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-semibold">No entries yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Once you submit a screenplay, your entries will appear here. Each submission becomes an
        entrant record that you — and any connected agent — can list and score.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button size="sm" asChild>
          <Link to="/submit">Submit a screenplay</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/ai-competition">Browse competitions</Link>
        </Button>
      </div>
    </div>
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

// Silence unused-import warnings when tree-shaken.
void supabase;
