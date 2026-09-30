import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, X, ArrowRight, Users } from "lucide-react";
import type { AliasRow } from "@/lib/character-aliases";

interface Props {
  universeId: string;
  aliases: (AliasRow & { id: string })[];
  detectedCharacters: string[];
  onChanged: () => void;
}

export default function CharacterAliasManager({ universeId, aliases, detectedCharacters, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [canonical, setCanonical] = useState("");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!canonical.trim() || !alias.trim()) return;
    setSaving(true);
    await supabase.from("universe_character_aliases" as any).insert({
      universe_id: universeId,
      canonical_name: canonical.trim().toUpperCase(),
      alias_name: alias.trim().toUpperCase(),
    } as any);
    setSaving(false);
    setCanonical("");
    setAlias("");
    setAdding(false);
    onChanged();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("universe_character_aliases" as any).delete().eq("id", id);
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Character Aliases</span>
        </div>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="text-xs gap-1">
            <Plus className="h-3 w-3" /> Add Alias
          </Button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground font-mono">
        Link character names that refer to the same person across installments.
      </p>

      {/* Existing aliases */}
      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {aliases.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-full border border-primary/20 bg-primary/5 text-foreground">
              {a.alias_name}
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
              {a.canonical_name}
              <button onClick={() => handleDelete(a.id)} className="ml-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {aliases.length === 0 && !adding && (
        <p className="text-[10px] text-muted-foreground/60 font-mono italic">No aliases defined yet.</p>
      )}

      {/* Add form */}
      {adding && (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground font-mono block mb-1">Alias (alternate name)</label>
              <select
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Select or type…</option>
                {detectedCharacters.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Or type a name…"
                className="w-full mt-1 bg-background border border-border rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-mono block mb-1">Canonical (primary name)</label>
              <select
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Select or type…</option>
                {detectedCharacters.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                placeholder="Or type a name…"
                className="w-full mt-1 bg-background border border-border rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={!canonical.trim() || !alias.trim() || saving} className="text-xs">
              {saving ? "Saving…" : "Save Alias"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} className="text-xs">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
