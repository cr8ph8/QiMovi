import { usePlatform } from "@/contexts/PlatformContext";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { useState } from "react";

export function DeveloperPanel() {
  const { mode, flags, toggleFlag } = usePlatform();
  const [open, setOpen] = useState(false);

  if (mode !== "developer") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-20 z-50 rounded-full border border-border/50 bg-card/95 px-3 py-2 text-xs font-mono text-primary shadow-lg backdrop-blur-sm hover:border-primary/50"
      >
        Flags
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 border-l border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-border/50">
            <h3 className="font-display text-sm font-semibold">Feature Flags</h3>
            <button onClick={() => setOpen(false)}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            {Object.values(flags).map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-lg border border-border/30 px-3 py-2">
                <div>
                  <p className="text-sm font-body">{f.id}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{f.tier} · {f.token_cost > 0 ? `${f.token_cost}⊘` : "free"}</p>
                </div>
                <Switch checked={f.enabled} onCheckedChange={() => toggleFlag(f.id)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
