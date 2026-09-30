import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, X, Bug, Lightbulb, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "react-router-dom";

const CATEGORIES = [
  { value: "bug", label: "Bug", icon: Bug, color: "text-destructive" },
  { value: "suggestion", label: "Suggestion", icon: Lightbulb, color: "text-amber-500" },
  { value: "question", label: "Question", icon: HelpCircle, color: "text-primary" },
  { value: "other", label: "Other", icon: MessageCircle, color: "text-muted-foreground" },
] as const;

export function TesterFeedbackButton() {
  const { user, isTester } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [openCount, setOpenCount] = useState(0);

  useEffect(() => {
    if (!user || !isTester) return;
    supabase
      .from("tester_feedback" as any)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "open")
      .then(({ count }) => setOpenCount(count || 0));
  }, [user, isTester]);

  // Track page visits for tester activity
  useEffect(() => {
    if (!user || !isTester) return;
    supabase.from("tester_activity_log" as any).insert({
      user_id: user.id,
      action: "page_view",
      page_url: location.pathname,
      metadata: { search: location.search },
    } as any);
  }, [user, isTester, location.pathname]);

  if (!isTester || !user) return null;

  async function handleSubmit() {
    if (!message.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from("tester_feedback" as any).insert({
      user_id: user!.id,
      category,
      message: message.trim(),
      page_url: window.location.pathname,
    } as any);
    setSubmitting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Feedback sent!", description: "Thank you for helping improve the platform." });
      setMessage("");
      setOpen(false);
      setOpenCount((c) => c + 1);
    }
  }

  return (
    <>
      {/* Floating ? Button */}
      <motion.button
        onClick={() => setOpen(!open)}
        className="fixed bottom-20 right-5 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
      >
        <HelpCircle className="h-6 w-6" />
        {openCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-[10px] font-mono font-bold text-white flex items-center justify-center">
            {openCount}
          </span>
        )}
      </motion.button>

      {/* Feedback Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-36 right-5 z-50 w-80 rounded-xl border border-border/50 bg-card shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/30 bg-primary/5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary">
                  TESTER
                </Badge>
                <span className="font-display text-sm font-bold">Send Feedback</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Category selector */}
              <div className="flex gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => setCategory(cat.value)}
                    className={`flex flex-col items-center gap-1 flex-1 p-2 rounded-lg border transition-colors text-xs font-body ${
                      category === cat.value
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/30 hover:border-border"
                    }`}
                  >
                    <cat.icon className={`h-4 w-4 ${cat.color}`} />
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Message */}
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe what you noticed…"
                rows={4}
                className="bg-muted border-border resize-none text-sm"
              />

              {/* Page URL */}
              <p className="text-[10px] font-mono text-muted-foreground truncate">
                Page: {window.location.pathname}
              </p>

              <Button
                onClick={handleSubmit}
                disabled={submitting || !message.trim()}
                className="w-full bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90"
                size="sm"
              >
                {submitting ? "Sending…" : (
                  <>
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    Submit Feedback
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
