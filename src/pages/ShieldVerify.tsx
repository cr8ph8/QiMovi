import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Shield, Check, X, ArrowLeft, Copy, ClipboardCheck, AlertTriangle, Link2, Upload, Loader2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { RiskBadge } from "@/components/shield/RiskBadge";
import { ShieldDisclaimer } from "@/components/shield/ShieldDisclaimer";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RiskBand } from "@/lib/shield/scoring";

interface VerificationResult {
  certificate_number: string;
  status: string;
  issued_at: string;
  revoked_at: string | null;
  project_title: string;
  writer_name: string | null;
  draft_number: string | null;
  risk_band: string | null;
  authorship_integrity_score: number | null;
  sha256_hash: string;
}

export default function ShieldVerify() {
  const { hash } = useParams<{ hash: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    if (!hash) return;
    (async () => {
      const { data } = await supabase.rpc("verify_authorship_certificate", { _hash: hash });
      setResult((Array.isArray(data) ? data[0] : data) ?? null);
      setLoading(false);
    })();
  }, [hash]);


  return (
    <div className="min-h-screen bg-cinema pt-24 pb-20">
      <div className="container max-w-2xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/authorship-shield"><ArrowLeft className="h-4 w-4 mr-1" /> Authorship Shield</Link>
        </Button>

        <div className="text-center space-y-2">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-shield/40 bg-shield/10 text-shield text-[11px] font-mono uppercase tracking-widest">
            <Shield className="h-3 w-3" /> Certificate Verification
          </span>
          <h1 className="font-display text-3xl md:text-4xl font-bold">Verify a Qi Authorship Certificate</h1>
        </div>

        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : result ? (
          <Card className="border-shield/30">
            <CardContent className="p-8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.revoked_at ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30 text-xs font-mono uppercase">
                      <X className="h-3 w-3" /> Revoked
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono uppercase">
                      <Check className="h-3 w-3" /> Verified
                    </span>
                  )}
                  {result.risk_band && <RiskBadge band={result.risk_band as RiskBand} />}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{result.certificate_number}</span>
              </div>

              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-shield">Project</p>
                <p className="font-display text-2xl">{result.project_title}</p>
                <p className="text-sm text-muted-foreground">
                  {result.writer_name ?? "Anonymous"} · Draft {result.draft_number ?? "—"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm border-y border-border/40 py-4">
                <Row label="Status" value={result.status.replace(/_/g, " ")} />
                <Row label="Issued" value={new Date(result.issued_at).toLocaleString()} />
                {result.authorship_integrity_score != null && (
                  <Row label="Integrity Score" value={`${Math.round(result.authorship_integrity_score)}/100`} />
                )}
                {result.revoked_at && (
                  <Row label="Revoked" value={new Date(result.revoked_at).toLocaleString()} />
                )}
              </div>

              <HashVerification result={result} />

              <ShieldDisclaimer variant="certificate" />
            </CardContent>
          </Card>
        ) : (
          <Card className="border-destructive/30">
            <CardContent className="p-8 text-center space-y-3">
              <X className="h-10 w-10 text-destructive mx-auto" />
              <h2 className="font-display text-xl">No certificate matches this hash</h2>
              <p className="text-sm text-muted-foreground break-all">
                Hash: <code>{hash}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                The hash may be mistyped, or the certificate may not have been issued through CanIScreenwrite.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

// ─── SHA-256 verification with claimed-hash input ───────────────────────
//
// Renders the canonical certificate hash plus a "paste the hash you were
// given" input so the reader can prove custody without visually diffing 64
// hex chars. The banner turns green on an exact case-insensitive match,
// red on any mismatch (with the differing chars highlighted), and a
// "Copy evidence" block emits a signed, quotable receipt including the
// verification URL, timestamp, and both hashes for a paper trail.
function HashVerification({ result }: { result: VerificationResult }) {
  const canonical = result.sha256_hash.trim().toLowerCase();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialClaim = searchParams.get("claim") ?? "";
  const initialCtx = searchParams.get("ctx") ?? "";
  const [claim, setClaim] = useState(initialClaim);
  const [ctx, setCtx] = useState(initialCtx);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [hashing, setHashing] = useState(false);
  const [hashError, setHashError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Normalize: trim, strip whitespace, drop optional 0x prefix, lowercase.
  const normalized = claim
    .trim()
    .toLowerCase()
    .replace(/^0x/, "")
    .replace(/\s+/g, "");
  const hasClaim = normalized.length > 0;
  const invalidChars = normalized.match(/[^0-9a-f]/g);
  const invalidCharSet = invalidChars
    ? Array.from(new Set(invalidChars)).slice(0, 6)
    : [];
  const hasInvalidChars = invalidCharSet.length > 0;
  const lengthOk = normalized.length === canonical.length;
  const isValidHex = hasClaim && !hasInvalidChars && lengthOk;
  const isMatch = isValidHex && normalized === canonical;
  const fileMatchesClaim = !!fileHash && isValidHex && fileHash === normalized;
  const fileMatchesCanonical = !!fileHash && fileHash === canonical;

  async function handleFile(file: File) {
    setHashError(null);
    setFileHash(null);
    setFileMeta({ name: file.name, size: file.size });
    setHashing(true);
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setFileHash(hex);
      toast.success("File hashed locally", {
        description: "Nothing was uploaded — SHA-256 was computed in your browser.",
      });
    } catch (e) {
      setHashError(e instanceof Error ? e.message : "Failed to hash file");
    } finally {
      setHashing(false);
    }
  }

  const diffChars = useMemo(() => {
    if (!hasClaim) return [] as { char: string; diff: boolean }[];
    const len = Math.max(canonical.length, normalized.length);
    const out: { char: string; diff: boolean }[] = [];
    for (let i = 0; i < len; i++) {
      const a = canonical[i] ?? "";
      const b = normalized[i] ?? "";
      out.push({ char: b || "·", diff: a !== b });
    }
    return out;
  }, [canonical, normalized, hasClaim]);

  const diffCount = diffChars.filter((c) => c.diff).length;

  function copyHash() {
    navigator.clipboard.writeText(result.sha256_hash);
    toast.success("Canonical hash copied");
  }

  function copyEvidence() {
    const url = buildShareUrl();
    const stamp = new Date().toISOString();
    const status = result.revoked_at
      ? `REVOKED at ${result.revoked_at}`
      : "VERIFIED";
    const block = [
      "Qi Authorship Certificate — Verification Evidence",
      "───────────────────────────────────────────────",
      `Certificate: ${result.certificate_number}`,
      `Project:     ${result.project_title}`,
      `Writer:      ${result.writer_name ?? "Anonymous"}`,
      `Draft:       ${result.draft_number ?? "—"}`,
      `Issued:      ${result.issued_at}`,
      `Status:      ${status}`,
      `Canonical:   ${result.sha256_hash}`,
      hasClaim ? `Claimed:     ${normalized}` : null,
      hasClaim
        ? `Match:       ${isMatch ? "YES — exact" : `NO — ${diffCount} differing char${diffCount === 1 ? "" : "s"}`}`
        : null,
      ctx.trim() ? `Context:     ${ctx.trim()}` : null,
      `Verified at: ${stamp}`,
      url ? `Source URL:  ${url}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(block);
    toast.success("Evidence receipt copied");
  }

  function buildReceipt() {
    return {
      schema: "qi.authorship.verification-receipt/v1",
      verified_at: new Date().toISOString(),
      source_url: buildShareUrl() || null,
      certificate: {
        number: result.certificate_number,
        status: result.status,
        issued_at: result.issued_at,
        revoked_at: result.revoked_at,
        project_title: result.project_title,
        writer_name: result.writer_name,
        draft_number: result.draft_number,
        risk_band: result.risk_band,
        authorship_integrity_score: result.authorship_integrity_score,
        canonical_sha256: result.sha256_hash,
      },
      claim: hasClaim
        ? {
            claimed_sha256: normalized,
            valid_hex: isValidHex,
            match: isValidHex ? isMatch : false,
            differing_chars: isValidHex && !isMatch ? diffCount : null,
          }
        : null,
      file_hash: fileHash
        ? {
            sha256: fileHash,
            file_name: fileMeta?.name ?? null,
            file_size: fileMeta?.size ?? null,
            matches_canonical: fileMatchesCanonical,
            matches_claim: fileMatchesClaim,
          }
        : null,
      context: ctx.trim() || null,
    };
  }

  function downloadReceipt() {
    const receipt = buildReceipt();
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeCert = result.certificate_number.replace(/[^a-z0-9_-]/gi, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `qi-verification-${safeCert}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Receipt downloaded", {
      description: "Attach the JSON file to your submission as proof of verification.",
    });
  }

  function buildShareUrl(): string {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    if (normalized) url.searchParams.set("claim", normalized);
    else url.searchParams.delete("claim");
    if (ctx.trim()) url.searchParams.set("ctx", ctx.trim());
    else url.searchParams.delete("ctx");
    return url.toString();
  }

  function copyShareUrl() {
    const url = buildShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    // Reflect the current claim/ctx in the address bar for a stable permalink.
    const next = new URLSearchParams(searchParams);
    if (normalized) next.set("claim", normalized);
    else next.delete("claim");
    if (ctx.trim()) next.set("ctx", ctx.trim());
    else next.delete("ctx");
    setSearchParams(next, { replace: true });
    toast.success("Shareable verification URL copied", {
      description: hasClaim
        ? "Opens this certificate pre-filled with your claimed hash."
        : "Opens this certificate — add a claimed hash to pre-fill the check.",
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          SHA-256 Hash (canonical)
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[10px] font-mono break-all bg-background/40 p-2 rounded border border-border/30">
            {result.sha256_hash}
          </code>
          <Button size="sm" variant="ghost" onClick={copyHash} aria-label="Copy canonical hash">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border/40 bg-background/30 p-3">
        <label
          htmlFor="claimed-hash"
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
        >
          Paste the hash you were given
        </label>
        <Input
          id="claimed-hash"
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          onPaste={(e) => {
            // Auto-normalize on paste: strip whitespace + 0x, lowercase.
            const text = e.clipboardData.getData("text");
            if (text) {
              e.preventDefault();
              setClaim(text.trim().replace(/\s+/g, "").replace(/^0x/i, "").toLowerCase());
            }
          }}
          placeholder="e.g. 3b7c…f091 (64 hex chars, 0x prefix ok)"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          maxLength={130}
          inputMode="text"
          pattern="[0-9a-fA-F]*"
          aria-invalid={hasClaim && !isValidHex}
          className={cn(
            "font-mono text-[11px]",
            hasClaim && !isValidHex && "border-destructive focus-visible:ring-destructive",
          )}
          aria-describedby="claimed-hash-banner"
        />

        {hasClaim && (
          <p
            className="text-[10px] font-mono text-muted-foreground"
            aria-live="polite"
          >
            {normalized.length}/{canonical.length} hex chars
            {claim !== normalized && " · auto-normalized"}
          </p>
        )}

        {hasClaim && hasInvalidChars && (
          <p
            id="claimed-hash-banner"
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Invalid hex — SHA-256 uses only <code>0-9</code> and <code>a-f</code>.
              Remove:{" "}
              <code className="font-mono">
                {invalidCharSet.map((c) => JSON.stringify(c)).join(" ")}
              </code>
            </span>
          </p>
        )}

        {hasClaim && !hasInvalidChars && !lengthOk && (
          <p
            id="claimed-hash-banner"
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Wrong length — expected {canonical.length} hex chars, got{" "}
              {normalized.length}. Keep pasting or check for truncation.
            </span>
          </p>
        )}

        {isValidHex && (
          <div
            id="claimed-hash-banner"
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              isMatch
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {isMatch ? (
              <Check className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div className="space-y-0.5">
              <p className="font-medium">
                {isMatch
                  ? "Match — this hash is authentic."
                  : "Mismatch — this hash does not match the certificate."}
              </p>
              <p className="text-[10.5px] opacity-80">
                {isMatch
                  ? "The pasted hash is byte-identical to the on-file SHA-256."
                  : `${diffCount} of ${canonical.length} characters differ. Highlighted below.`}
              </p>
            </div>
          </div>
        )}

        {isValidHex && !isMatch && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Character diff (claimed vs canonical)
            </p>
            <code
              className="block text-[10px] font-mono break-all bg-background/60 p-2 rounded border border-border/30 leading-relaxed"
              aria-label="Character by character diff"
            >
              {diffChars.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    c.diff
                      ? "bg-destructive/30 text-destructive-foreground rounded-sm px-[1px]"
                      : "text-muted-foreground",
                  )}
                >
                  {c.char}
                </span>
              ))}
            </code>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-border/40 bg-background/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Hash a file locally
            </p>
            <p className="text-[11px] text-muted-foreground">
              Compute SHA-256 in your browser and compare it to the claimed
              hash. The file never leaves this device.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            aria-label="Choose file to hash"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={hashing}
          >
            {hashing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5 mr-1.5" />
            )}
            {hashing ? "Hashing…" : "Choose file"}
          </Button>
        </div>

        {fileMeta && (
          <div className="text-[11px] text-muted-foreground font-mono truncate">
            {fileMeta.name} · {(fileMeta.size / 1024).toFixed(1)} KB
          </div>
        )}

        {hashError && (
          <p className="text-[11px] text-destructive">{hashError}</p>
        )}

        {fileHash && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] font-mono break-all bg-background/40 p-2 rounded border border-border/30">
                {fileHash}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setClaim(fileHash);
                  toast.success("File hash placed in claim field");
                }}
                aria-label="Use file hash as claimed hash"
              >
                Use as claim
              </Button>
            </div>
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                fileMatchesCanonical
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : hasClaim && fileMatchesClaim
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {fileMatchesCanonical || fileMatchesClaim ? (
                <Check className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="space-y-0.5">
                <p className="font-medium">
                  {fileMatchesCanonical
                    ? "File matches the certified canonical hash."
                    : hasClaim && fileMatchesClaim
                      ? "File matches your claimed hash (but not the certified canonical)."
                      : hasClaim
                        ? "File does not match your claimed hash."
                        : "File does not match the canonical hash on this certificate."}
                </p>
                <p className="text-[10.5px] opacity-80">
                  {fileMatchesCanonical
                    ? "Byte-identical to the SHA-256 on file."
                    : hasClaim
                      ? fileMatchesClaim
                        ? "The claimed hash and this file agree — but the certificate is a different artifact."
                        : "Neither the claimed hash nor the canonical hash equal the file's SHA-256."
                      : "Paste the hash you were given above to compare against the file."}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>



      <div className="space-y-2 rounded-md border border-border/40 bg-background/30 p-3">
        <label
          htmlFor="evidence-ctx"
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
        >
          Evidence context (optional)
        </label>
        <Input
          id="evidence-ctx"
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
          placeholder="e.g. case #A-2412, exhibit B, or reviewer note"
          maxLength={200}
          className="text-[12px]"
        />
        <p className="text-[10.5px] text-muted-foreground">
          Included in the copied receipt and encoded into the shareable URL so
          the next opener sees the same framing.
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-shield/30 bg-shield/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-shield">
              Share this verification
            </p>
            <p className="text-[11px] text-muted-foreground">
              Copies a link that opens this certificate with your claimed hash
              and context pre-filled — no manual re-entry.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={copyShareUrl} aria-label="Copy shareable verification URL">
            <Link2 className="h-3.5 w-3.5 mr-1.5" /> Copy link
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-shield/20">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-shield">
              Copy evidence
            </p>
            <p className="text-[11px] text-muted-foreground">
              A quotable receipt with certificate #, hashes, verification URL,
              and timestamp — safe to paste into email or a case file.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={copyEvidence}>
            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Copy
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-shield/20">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-shield">
              Download receipt (JSON)
            </p>
            <p className="text-[11px] text-muted-foreground">
              A machine-readable receipt with certificate metadata, canonical +
              claimed hashes, file hash, and context — attach it directly to
              your submission.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={downloadReceipt} aria-label="Download verification receipt JSON">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}
