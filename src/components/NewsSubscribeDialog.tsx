import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell, Loader2 } from "lucide-react";

const CATEGORY_OPTIONS = [
  { value: "feature_release", label: "Feature releases" },
  { value: "system_update", label: "System updates" },
  { value: "competition", label: "Competitions" },
  { value: "announcement", label: "Announcements" },
  { value: "legal", label: "Legal" },
  { value: "retirement", label: "Retirements" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function NewsSubscribeDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>(
    CATEGORY_OPTIONS.map((c) => c.value)
  );
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    supabase
      .from("news_subscriptions" as any)
      .select("categories,email_opt_in")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCategories((data as any).categories || []);
          setEmailOptIn((data as any).email_opt_in || false);
          setExists(true);
        }
        setLoading(false);
      });
  }, [open, user]);

  const toggleCategory = (value: string) => {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      categories,
      email_opt_in: emailOptIn,
    };
    const { error } = exists
      ? await supabase
          .from("news_subscriptions" as any)
          .update(payload)
          .eq("user_id", user.id)
      : await supabase.from("news_subscriptions" as any).insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Couldn't save your preferences.");
      return;
    }
    toast.success("Subscribed to updates.");
    setExists(true);
    onOpenChange(false);
  };

  const handleUnsubscribe = async () => {
    if (!user) return;
    setSaving(true);
    await supabase
      .from("news_subscriptions" as any)
      .delete()
      .eq("user_id", user.id);
    setSaving(false);
    setExists(false);
    setEmailOptIn(false);
    toast.success("Unsubscribed.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Bell className="h-4 w-4 text-primary" />
            Subscribe to updates
          </DialogTitle>
          <DialogDescription>
            Get in-app notifications when something new ships. Pick the
            categories you care about.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Sign in to manage your subscription preferences.
            </p>
            <Button asChild variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        ) : loading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              {CATEGORY_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-3">
                  <Checkbox
                    id={`cat-${opt.value}`}
                    checked={categories.includes(opt.value)}
                    onCheckedChange={() => toggleCategory(opt.value)}
                  />
                  <Label
                    htmlFor={`cat-${opt.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {opt.label}
                  </Label>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <div>
                <Label htmlFor="email-opt-in" className="text-sm">
                  Also email me
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One email per published post, in your selected categories.
                </p>
              </div>
              <Switch
                id="email-opt-in"
                checked={emailOptIn}
                onCheckedChange={setEmailOptIn}
              />
            </div>
          </div>
        )}

        {user && !loading && (
          <DialogFooter className="gap-2 sm:gap-2">
            {exists && (
              <Button
                variant="ghost"
                onClick={handleUnsubscribe}
                disabled={saving}
                className="mr-auto text-muted-foreground"
              >
                Unsubscribe
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || categories.length === 0}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : exists ? (
                "Save preferences"
              ) : (
                "Subscribe"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
