import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, Check, CheckCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  useEffect(() => {
    if (!user) return;

    async function fetch() {
      const { data } = await supabase
        .from("user_notifications")
        .select("id, title, message, type, read, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      const items = (data || []) as Notification[];
      setNotifications(items);
      setUnreadCount(items.filter((n) => !n.read).length);
    }

    fetch();

    // Realtime — postgres_changes only (broadcast/presence blocked by policy)
    // See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions
    const channel = supabase
      .channel("user-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 20));
          setUnreadCount((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function markRead(id: string) {
    await supabase.from("user_notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    if (!user) return;
    await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  async function deleteNotif(id: string) {
    const notif = notifications.find((n) => n.id === id);
    await supabase.from("user_notifications").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (notif && !notif.read) setUnreadCount((prev) => Math.max(0, prev - 1));
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  const typeColor: Record<string, string> = {
    success: "bg-primary",
    warning: "bg-yellow-500",
    error: "bg-destructive",
    info: "bg-blue-500",
  };

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted/50 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-mono font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2 z-50 w-[320px] md:w-[360px] rounded-2xl border border-border/60 bg-card shadow-2xl shadow-background/80 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-primary" />
                <span className="font-display text-sm font-bold">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors px-1.5 py-0.5 rounded hover:bg-primary/5"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div className="max-h-[360px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/60 font-body">No notifications yet</p>
                </div>
              ) : (
                <div className="py-1">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`group flex items-start gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors ${
                        !notif.read ? "bg-primary/[0.03]" : ""
                      }`}
                    >
                      {/* Unread dot */}
                      <div className="mt-1.5 shrink-0">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            !notif.read
                              ? typeColor[notif.type] || "bg-primary"
                              : "bg-transparent"
                          }`}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-body font-medium text-foreground leading-tight">
                          {notif.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-body mt-0.5 line-clamp-2 leading-snug">
                          {notif.message}
                        </p>
                        <p className="text-[9px] text-muted-foreground/50 font-mono mt-1">
                          {timeAgo(notif.created_at)} ago
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!notif.read && (
                          <button
                            onClick={() => markRead(notif.id)}
                            className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-primary transition-colors"
                            title="Mark as read"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotif(notif.id)}
                          className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
