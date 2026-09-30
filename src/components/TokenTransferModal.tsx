import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Search, ArrowRight, CheckCircle2 } from "lucide-react";

interface Profile {
  user_id: string;
  display_name: string | null;
  pen_name: string | null;
}

type Step = "search" | "confirm" | "done";

const TOKEN_TRANSFERS_ON_HOLD = true;

export default function TokenTransferModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { balance, refresh } = useWallet();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<Profile | null>(null);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("search");
      setQuery("");
      setResults([]);
      setRecipient(null);
      setAmount("");
      setSending(false);
    }
  }, [open]);

  const searchUsers = useCallback(async (q: string) => {
    if (TOKEN_TRANSFERS_ON_HOLD) { setResults([]); return; }
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const pattern = `%${q}%`;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, display_name, pen_name")
      .or(`display_name.ilike.${pattern},pen_name.ilike.${pattern}`)
      .neq("user_id", user?.id ?? "")
      .limit(8);
    setResults((data as Profile[]) || []);
    setSearching(false);
  }, [user]);

  // Debounced search
  useEffect(() => {
    if (step !== "search") return;
    const t = setTimeout(() => searchUsers(query), 300);
    return () => clearTimeout(t);
  }, [query, step, searchUsers]);

  const parsedAmount = parseInt(amount, 10);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0 && (balance === null || parsedAmount <= balance);

  const handleConfirm = () => {
    if (TOKEN_TRANSFERS_ON_HOLD) return;
    if (!recipient || !amountValid) return;
    setStep("confirm");
  };

  const handleSend = async () => {
    if (TOKEN_TRANSFERS_ON_HOLD) return;
    if (!recipient || !amountValid) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("transfer-tokens", {
      body: { recipient_id: recipient.user_id, amount: parsedAmount },
    });
    setSending(false);

    if (error || data?.error) {
      const msg = data?.error || error?.message || "Transfer failed";
      toast({ title: "Transfer failed", description: msg, variant: "destructive" });
      return;
    }

    await refresh();
    setStep("done");
    toast({ title: "Tokens sent!", description: `${parsedAmount} tokens transferred successfully.` });
  };

  const recipientLabel = (p: Profile) => p.pen_name || p.display_name || "Unknown user";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Send Tokens</DialogTitle>
          <DialogDescription>
            {TOKEN_TRANSFERS_ON_HOLD
              ? "Transfers are temporarily paused while we complete a security upgrade."
              : "Transfer tokens to another writer on the platform."}
          </DialogDescription>
        </DialogHeader>

        {step === "search" && (
          <div className="space-y-4">
            {/* Recipient search */}
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">Recipient</label>
              {recipient ? (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
                  <span className="font-medium text-sm">{recipientLabel(recipient)}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" disabled={TOKEN_TRANSFERS_ON_HOLD} onClick={() => { setRecipient(null); setQuery(""); }}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or pen name…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                    autoFocus
                    disabled={TOKEN_TRANSFERS_ON_HOLD}
                  />
                  {(results.length > 0 || searching) && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-48 overflow-y-auto">
                      {searching && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                        </div>
                      )}
                      {results.map((p) => (
                        <button
                          key={p.user_id}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                          onClick={() => { setRecipient(p); setResults([]); setQuery(""); }}
                        >
                          <span className="font-medium">{p.display_name || "—"}</span>
                          {p.pen_name && <span className="ml-2 text-muted-foreground text-xs">({p.pen_name})</span>}
                        </button>
                      ))}
                      {!searching && results.length === 0 && query.length >= 2 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No users found</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">Amount</label>
              <Input
                type="number"
                min={1}
                max={balance ?? undefined}
                placeholder="Enter token amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={TOKEN_TRANSFERS_ON_HOLD}
              />
              {balance !== null && (
                <p className="text-xs text-muted-foreground mt-1">Your balance: <span className="font-semibold text-foreground">{balance}</span> tokens</p>
              )}
              {amount && !amountValid && (
                <p className="text-xs text-destructive mt-1">
                  {parsedAmount > (balance ?? 0) ? "Insufficient balance" : "Enter a valid amount"}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={TOKEN_TRANSFERS_ON_HOLD || !recipient || !amountValid} onClick={handleConfirm}>
                Review <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && recipient && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">You are about to send</p>
              <p className="font-display text-3xl font-bold text-primary">{parsedAmount} <span className="text-base font-normal text-muted-foreground">tokens</span></p>
              <p className="text-sm text-muted-foreground">to <span className="font-semibold text-foreground">{recipientLabel(recipient)}</span></p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("search")}>Back</Button>
              <Button onClick={handleSend} disabled={TOKEN_TRANSFERS_ON_HOLD || sending} className="bg-gold-gradient text-primary-foreground font-semibold hover:opacity-90">
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Confirm Transfer
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <p className="font-display text-lg font-semibold">Transfer Complete</p>
            <p className="text-sm text-muted-foreground">Your new balance is <span className="font-semibold text-foreground">{balance}</span> tokens.</p>
            <Button onClick={() => onOpenChange(false)} className="mt-2">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
