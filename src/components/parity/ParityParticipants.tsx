import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { TIER_DEFAULT_UNITS, TIER_LABELS } from "@/lib/parity/defaults";
import type { ParityParticipant, ParityRoleTier } from "@/lib/parity/types";

interface Props {
  participants: ParityParticipant[];
  onAdd: (p: Omit<ParityParticipant, "id" | "deal_id">) => void;
  onUpdate: (id: string, patch: Partial<ParityParticipant>) => void;
  onRemove: (id: string) => void;
}

export default function ParityParticipants({ participants, onAdd, onUpdate, onRemove }: Props) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<ParityRoleTier>("supporting");

  const totalUnits = participants.reduce((s, p) => s + p.unit_weight, 0);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      collaborator_id: null,
      display_name_override: name.trim(),
      role_tier: tier,
      unit_weight: TIER_DEFAULT_UNITS[tier],
    });
    setName("");
    setTier("supporting");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Covered participants and their unit weights. Pool payouts split pro-rata by units.
        </p>
        <span className="text-[11px] font-mono text-muted-foreground">
          {participants.length} participants · {totalUnits} units
        </span>
      </div>

      {participants.length > 0 && (
        <div className="rounded-md border border-border/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Role Tier</th>
                <th className="text-right px-3 py-2 w-24">Units</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id} className="border-t border-border/40">
                  <td className="px-3 py-2">
                    <Input
                      value={p.display_name_override ?? ""}
                      onChange={(e) => onUpdate(p.id, { display_name_override: e.target.value })}
                      className="h-8 bg-transparent border-0 focus-visible:ring-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select value={p.role_tier} onValueChange={(v) => onUpdate(p.id, { role_tier: v as ParityRoleTier, unit_weight: TIER_DEFAULT_UNITS[v as ParityRoleTier] })}>
                      <SelectTrigger className="h-8 bg-transparent border-0 focus:ring-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TIER_LABELS) as ParityRoleTier[]).map((t) => (
                          <SelectItem key={t} value={t}>{TIER_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      value={p.unit_weight}
                      onChange={(e) => onUpdate(p.id, { unit_weight: parseInt(e.target.value) || 0 })}
                      className="h-8 text-right bg-transparent border-0 focus-visible:ring-1"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onRemove(p.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add row */}
      <div className="flex items-end gap-2 rounded-md border border-dashed border-border/50 p-3">
        <div className="flex-1 space-y-1">
          <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Add participant</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="bg-background/40" />
        </div>
        <div className="w-56 space-y-1">
          <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Tier</Label>
          <Select value={tier} onValueChange={(v) => setTier(v as ParityRoleTier)}>
            <SelectTrigger className="bg-background/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TIER_LABELS) as ParityRoleTier[]).map((t) => (
                <SelectItem key={t} value={t}>{TIER_LABELS[t]} ({TIER_DEFAULT_UNITS[t]}u)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleAdd} disabled={!name.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}
