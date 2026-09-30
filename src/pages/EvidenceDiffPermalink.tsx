/**
 * EvidenceDiffPermalink — shareable, hash-pinned diff view.
 *
 * URL shape:
 *   /evidence/:entryId/diff?hash=<evidence_bundle_hash>&v=<optional-version-label>
 *
 * Purpose: give entrants and judges a single link that resolves to the exact
 * same private-vs-public diff for a specific submission version. The link
 * pins the `evidence_bundle_hash` of the submission it was cut against — if
 * the entry has since been re-hashed, the page renders a prominent drift
 * banner so both parties know they're no longer looking at the same state.
 *
 * Read-only. The underlying `PrivateVsPublicDiff` still enforces RLS (only
 * the entry owner or ops can hydrate the row), so this page is safe to link
 * around freely — non-owners simply see the empty state from that component.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PrivateVsPublicDiff } from "@/components/evidence/PrivateVsPublicDiff";

interface PinnedEntry {
  id: string;
  title: string | null;
  evidence_bundle_hash: string | null;
}

export default function EvidenceDiffPermalink() {
  const { entryId } = useParams<{ entryId: string }>();
  const [searchParams] = useSearchParams();
  const pinnedHash = searchParams.get("hash");
  const versionLabel = searchParams.get("v");

  const [entry, setEntry] = useState<PinnedEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("entries")
        .select("id,title,evidence_bundle_hash")
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      setEntry((data as PinnedEntry) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const drift = useMemo(() => {
    if (!pinnedHash || !entry) return null;
    if (!entry.evidence_bundle_hash) return "no_live_hash";
    if (entry.evidence_bundle_hash !== pinnedHash) return "hash_mismatch";
    return null;
  }, [pinnedHash, entry]);

  const permalink = useMemo(() => {
    if (typeof window === "undefined" || !entryId) return "";
    const url = new URL(window.location.href);
    // Ensure the shareable link always carries the hash it was cut against.
    // Fall back to the live hash if the current URL didn't include one.
    const hashToPin = pinnedHash ?? entry?.evidence_bundle_hash ?? null;
    if (hashToPin) url.searchParams.set("hash", hashToPin);
    else url.searchParams.delete("hash");
    return url.toString();
  }, [entryId, pinnedHash, entry?.evidence_bundle_hash]);

  const copyLink = async () => {
    if (!permalink) return;
    try {
      await navigator.clipboard.writeText(permalink);
      toast.success("Permalink copied", {
        description: pinnedHash
          ? "Anyone opening this link sees the diff pinned to the same submission hash."
          : "Link copied — the live entry hash was auto-pinned.",
      });
    } catch {
      toast.error("Copy failed");
    }
  };

  if (!entryId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted-foreground">
          No entry id supplied.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 font-display text-lg font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Evidence diff — shareable snapshot
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Loads the private vs. public evidence comparison for a specific
              submission, pinned to the exact hash it was cut against.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copyLink}
            className="h-8 text-xs shrink-0"
          >
            <Copy className="h-3 w-3 mr-1.5" />
            Copy permalink
          </Button>
        </div>

        {loading ? (
          <Skeleton className="h-6 w-2/3" />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
            {entry?.title && (
              <Badge
                variant="outline"
                className="border-border/50 text-muted-foreground uppercase tracking-wider"
              >
                {entry.title}
              </Badge>
            )}
            {versionLabel && (
              <Badge
                variant="outline"
                className="border-primary/40 text-primary bg-primary/5 uppercase tracking-wider"
              >
                v{versionLabel}
              </Badge>
            )}
            {pinnedHash && (
              <Badge
                variant="outline"
                className="border-border/50 text-muted-foreground"
                title="Evidence bundle hash this link is pinned to"
              >
                hash: {pinnedHash.slice(0, 12)}…
              </Badge>
            )}
            {!pinnedHash && entry?.evidence_bundle_hash && (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-300 bg-amber-500/5 uppercase tracking-wider"
                title="This URL did not pin a hash — the copy button will pin the current live hash."
              >
                unpinned
              </Badge>
            )}
          </div>
        )}

        {drift === "hash_mismatch" && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                This submission has been re-hashed since the link was created.
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-destructive/90 break-all">
                pinned: {pinnedHash}
                <br />
                live:&nbsp;&nbsp;{entry?.evidence_bundle_hash}
              </p>
              <p className="mt-1 text-[11px] text-destructive/90">
                The diff below reflects the entry's <em>current</em> state, not
                the state at the pinned hash. Re-cut the permalink to sync
                reviewers.
              </p>
            </div>
          </div>
        )}
        {drift === "no_live_hash" && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-300 flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              The entry has no evidence bundle hash yet, so the pinned hash
              can't be verified. The diff will render against the entry's
              current draft state.
            </p>
          </div>
        )}
      </header>

      <PrivateVsPublicDiff
        entryId={entryId}
        initialRole={
          (["entrant", "judge", "operator", "reader"] as const).includes(
            (searchParams.get("as") ?? "") as any,
          )
            ? (searchParams.get("as") as any)
            : "reader"
        }
      />
    </main>
  );
}
