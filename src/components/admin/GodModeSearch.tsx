import { useState, useEffect, useRef } from "react";
import { Search, User, FileText, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface SearchResult {
  type: "user" | "entry" | "transaction";
  id: string;
  label: string;
  sub: string;
}

export default function GodModeSearch({ onTabSwitch }: { onTabSwitch?: (tab: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      const q = `%${query}%`;
      const [profiles, entries, txns] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, pen_name").or(`display_name.ilike.${q},pen_name.ilike.${q}`).limit(5),
        supabase.from("entries").select("id, title, author, genre").or(`title.ilike.${q},author.ilike.${q},genre.ilike.${q}`).limit(5),
        supabase.from("wallet_transactions").select("id, label, amount, user_id").ilike("label", q).limit(5),
      ]);
      const r: SearchResult[] = [
        ...(profiles.data || []).map((p) => ({ type: "user" as const, id: p.user_id, label: p.display_name || p.pen_name || "Unknown", sub: p.pen_name ? `pen: ${p.pen_name}` : "user" })),
        ...(entries.data || []).map((e) => ({ type: "entry" as const, id: e.id, label: e.title, sub: e.genre || e.author || "entry" })),
        ...(txns.data || []).map((t) => ({ type: "transaction" as const, id: t.id, label: t.label, sub: `${t.amount > 0 ? "+" : ""}${t.amount} tokens` })),
      ];
      setResults(r);
      setOpen(r.length > 0);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const icon = (type: string) => {
    if (type === "user") return <User className="h-3.5 w-3.5 text-primary" />;
    if (type === "entry") return <FileText className="h-3.5 w-3.5 text-primary" />;
    return <Wallet className="h-3.5 w-3.5 text-primary" />;
  };

  const handleClick = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    if (r.type === "entry") onTabSwitch?.("competitions");
    if (r.type === "transaction") onTabSwitch?.("tokens");
    if (r.type === "user") onTabSwitch?.("access");
  };

  return (
    <div ref={ref} className="relative mb-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users, entries, transactions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9 font-mono text-sm bg-card/60 border-border/40"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border/50 bg-popover shadow-lg max-h-72 overflow-y-auto">
          {["user", "entry", "transaction"].map((type) => {
            const group = results.filter((r) => r.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted/30">
                  {type === "user" ? "Users" : type === "entry" ? "Entries" : "Transactions"}
                </div>
                {group.map((r) => (
                  <button key={r.id} onClick={() => handleClick(r)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent/50 text-left transition-colors">
                    {icon(r.type)}
                    <span className="font-body truncate">{r.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[120px]">{r.sub}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
        </div>
      )}
    </div>
  );
}
