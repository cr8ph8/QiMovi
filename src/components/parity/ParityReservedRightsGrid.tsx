import { RESERVED_RIGHTS, RESERVED_RIGHT_LABELS, type ReservedRight } from "@/lib/parity/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getJurisdiction } from "@/lib/parity/jurisdictions";

interface Props {
  value: ReservedRight[];
  onToggle: (right: ReservedRight) => void;
  jurisdiction?: string | null;
}

export default function ParityReservedRightsGrid({ value, onToggle, jurisdiction }: Props) {
  const j = getJurisdiction(jurisdiction);
  const labelFor = (r: ReservedRight) => j.rightsTermOverrides?.[r] ?? RESERVED_RIGHT_LABELS[r];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {RESERVED_RIGHTS.map((r) => {
          const checked = value.includes(r);
          return (
            <label
              key={r}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-2 text-sm cursor-pointer hover:border-primary/40 transition-colors"
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(r)} />
              <Label className="cursor-pointer font-normal text-xs">{labelFor(r)}</Label>
            </label>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground italic">{j.reservedRightsCaveat}</p>
    </div>
  );
}
