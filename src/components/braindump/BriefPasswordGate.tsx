import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  onSubmit: (password: string) => Promise<void>;
  error?: string | null;
  compact?: boolean;
}

export function BriefPasswordGate({ onSubmit, error, compact }: Props) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || pw.length === 0) return;
    setBusy(true);
    try {
      await onSubmit(pw);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`mx-auto w-full ${compact ? "max-w-sm" : "max-w-md"} rounded-xl border border-border/60 bg-card/60 p-6 space-y-4 backdrop-blur`}
    >
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-primary/10 p-2">
          <Lock className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-lg leading-tight">Passcode required</h2>
          <p className="text-xs text-muted-foreground">
            The author has restricted this brief. Enter the passcode to view it.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="brief-passcode" className="text-xs">Passcode</Label>
        <Input
          id="brief-passcode"
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          maxLength={128}
          placeholder="Enter passcode"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <Button type="submit" disabled={busy || pw.length === 0} className="w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Unlock brief
      </Button>
    </form>
  );
}
