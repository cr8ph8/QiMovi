import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const norm = (s: string | undefined | null) => (s ?? "").trim().toUpperCase();

interface Props {
  universeId: string;
  universeName?: string;
  briefCharacterNames: string[];
  aliases: Array<{ canonical_name: string; alias_name: string }>;
}

export function AliasPreflightPanel({
  universeId,
  universeName,
  briefCharacterNames,
  aliases,
}: Props) {
  const [open, setOpen] = useState(false);

  const canonicalSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of aliases) s.add(norm(a.canonical_name));
    return s;
  }, [aliases]);

  const aliasSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of aliases) s.add(norm(a.alias_name));
    return s;
  }, [aliases]);

  const aliasesByCanonical = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of aliases) {
      const key = norm(a.canonical_name);
      const list = m.get(key) ?? [];
      if (!list.includes(a.alias_name)) list.push(a.alias_name);
      m.set(key, list);
    }
    return m;
  }, [aliases]);

  const checks = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ name: string; status: "canonical" | "alias" | "missing" }> = [];
    for (const raw of briefCharacterNames) {
      const key = norm(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let status: "canonical" | "alias" | "missing" = "missing";
      if (canonicalSet.has(key)) status = "canonical";
      else if (aliasSet.has(key)) status = "alias";
      rows.push({ name: raw, status });
    }
    return rows;
  }, [briefCharacterNames, canonicalSet, aliasSet]);

  if (universeId === "none") return null;

  const missing = checks.filter((c) => c.status === "missing");
  const mapped = checks.filter((c) => c.status !== "missing");

  return (
    <div className="rounded-md border border-border/60 bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {missing.length > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-sm font-semibold truncate">
            Alias preflight{universeName ? ` — ${universeName}` : ""}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {aliases.length} alias{aliases.length === 1 ? "" : "es"}
          </Badge>
          {missing.length > 0 ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
              {missing.length} unmapped
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
              all mapped
            </Badge>
          )}
        </div>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
          {missing.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <div className="text-xs font-semibold text-amber-400 mb-1">
                Brief characters missing from the alias registry:
              </div>
              <div className="flex flex-wrap gap-1">
                {missing.map((m) => (
                  <Badge key={m.name} variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">
                    {m.name}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                These names will pass through unchanged. Add them to the franchise to lock them to a canonical identity.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-2 h-7 text-xs">
                <Link to={`/universe/${universeId}`}>
                  <ExternalLink className="h-3 w-3" /> Manage franchise
                </Link>
              </Button>
            </div>
          )}

          {mapped.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">
                Mapped characters ({mapped.length})
              </div>
              <div className="space-y-1">
                {mapped.map((m) => {
                  const canonicalKey = m.status === "canonical"
                    ? norm(m.name)
                    : aliases.find((a) => norm(a.alias_name) === norm(m.name))?.canonical_name ?? "";
                  const list = aliasesByCanonical.get(norm(canonicalKey)) ?? [];
                  return (
                    <div key={m.name} className="flex items-center gap-2 flex-wrap text-xs">
                      <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                        {m.name}
                      </Badge>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono uppercase text-[11px]">{canonicalKey}</span>
                      {list.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          ({list.join(", ")})
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {checks.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No brief characters detected to check.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
