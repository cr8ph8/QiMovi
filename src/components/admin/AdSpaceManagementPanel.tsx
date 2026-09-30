import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DollarSign, TrendingUp, Eye, MousePointer, Plus, Check, X } from "lucide-react";

interface AdSlot {
  id: string;
  festival_id: string | null;
  advertiser_name: string;
  advertiser_email: string;
  bid_amount_cents: number;
  status: string;
  slot_start: string | null;
  slot_end: string | null;
  notes: string;
  created_at: string;
}

interface AnalyticsSummary {
  totalRevenue: number;
  thisMonthRevenue: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  active: "bg-primary/20 text-primary border-primary/30",
  expired: "bg-muted/50 text-muted-foreground",
  rejected: "bg-destructive/10 text-destructive",
};

export default function AdSpaceManagementPanel() {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary>({ totalRevenue: 0, thisMonthRevenue: 0, totalImpressions: 0, totalClicks: 0, ctr: 0 });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newSlot, setNewSlot] = useState({ advertiser_name: "", advertiser_email: "", bid_amount_cents: 0 });

  async function fetchData() {
    setLoading(true);
    const [{ data: slotData }, { data: analyticsData }] = await Promise.all([
      supabase.from("festival_ad_slots").select("*").order("bid_amount_cents", { ascending: false }),
      supabase.from("ad_slot_analytics").select("event_type, created_at"),
    ]);

    const allSlots = (slotData || []) as AdSlot[];
    setSlots(allSlots);

    const approved = allSlots.filter(s => ["approved", "active"].includes(s.status));
    const totalRevenue = approved.reduce((sum, s) => sum + s.bid_amount_cents, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthRevenue = approved
      .filter(s => new Date(s.created_at) >= monthStart)
      .reduce((sum, s) => sum + s.bid_amount_cents, 0);

    const events = analyticsData || [];
    const impressions = events.filter((e: any) => e.event_type === "impression").length;
    const clicks = events.filter((e: any) => e.event_type === "click").length;

    setAnalytics({
      totalRevenue,
      thisMonthRevenue,
      totalImpressions: impressions,
      totalClicks: clicks,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    });
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  async function updateStatus(id: string, status: string) {
    const slot = slots.find(s => s.id === id);
    const updates: any = { status };
    if (status === "active") {
      updates.slot_start = new Date().toISOString();
      updates.slot_end = new Date(Date.now() + 30 * 86400000).toISOString();
    }
    await supabase.from("festival_ad_slots").update(updates).eq("id", id);
    toast.success(`Slot ${status}`);

    // Send email notification for status changes
    if (slot && ["approved", "active", "expired", "rejected"].includes(status)) {
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "ad-slot-status-change",
          recipientEmail: slot.advertiser_email,
          idempotencyKey: `ad-slot-${id}-${status}`,
          templateData: {
            advertiser_name: slot.advertiser_name,
            new_status: status,
            bid_amount: `$${(slot.bid_amount_cents / 100).toLocaleString()}`,
          },
        },
      });
    }

    fetchData();
  }

  async function addSlot() {
    if (!newSlot.advertiser_name || !newSlot.advertiser_email || newSlot.bid_amount_cents <= 0) {
      toast.error("Fill all fields");
      return;
    }
    await supabase.from("festival_ad_slots").insert([newSlot]);
    toast.success("Ad slot created");
    setNewSlot({ advertiser_name: "", advertiser_email: "", bid_amount_cents: 0 });
    setShowAdd(false);
    fetchData();
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Revenue cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4" /> Total Revenue</CardTitle></CardHeader>
          <CardContent><p className="font-display text-2xl font-bold">${(analytics.totalRevenue / 100).toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4" /> This Month</CardTitle></CardHeader>
          <CardContent><p className="font-display text-2xl font-bold">${(analytics.thisMonthRevenue / 100).toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-2"><Eye className="h-4 w-4" /> Impressions</CardTitle></CardHeader>
          <CardContent><p className="font-display text-2xl font-bold">{analytics.totalImpressions.toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-2"><MousePointer className="h-4 w-4" /> CTR</CardTitle></CardHeader>
          <CardContent><p className="font-display text-2xl font-bold">{analytics.ctr}%</p></CardContent>
        </Card>
      </div>

      {/* Slot management */}
      <Tabs defaultValue="queue">
        <TabsList className="bg-muted/30 border border-border/50">
          <TabsTrigger value="queue" className="font-mono text-xs">Bid Queue</TabsTrigger>
          <TabsTrigger value="active" className="font-mono text-xs">Active Slots</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-body font-semibold text-sm">All Bids</h3>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="h-4 w-4 mr-1" /> Add Slot
            </Button>
          </div>

          {showAdd && (
            <Card className="mb-4">
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input placeholder="Advertiser name" value={newSlot.advertiser_name} onChange={e => setNewSlot(p => ({ ...p, advertiser_name: e.target.value }))} />
                  <Input placeholder="Email" type="email" value={newSlot.advertiser_email} onChange={e => setNewSlot(p => ({ ...p, advertiser_email: e.target.value }))} />
                  <Input placeholder="Bid (cents)" type="number" value={newSlot.bid_amount_cents || ""} onChange={e => setNewSlot(p => ({ ...p, bid_amount_cents: parseInt(e.target.value) || 0 }))} />
                </div>
                <Button size="sm" onClick={addSlot}>Create</Button>
              </CardContent>
            </Card>
          )}

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Advertiser</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Bid</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 font-mono text-xs text-muted-foreground">Date</th>
                  <th className="text-right py-3 px-4 font-mono text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slots.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No ad slots yet.</td></tr>
                ) : slots.map(slot => (
                  <tr key={slot.id} className="border-b border-border/20">
                    <td className="py-3 px-4">
                      <div className="font-body font-medium">{slot.advertiser_name}</div>
                      <div className="text-xs text-muted-foreground">{slot.advertiser_email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-primary">${(slot.bid_amount_cents / 100).toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <Badge className={STATUS_COLORS[slot.status] || "bg-muted text-muted-foreground"}>{slot.status}</Badge>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{new Date(slot.created_at).toLocaleDateString()}</td>
                    <td className="py-3 px-4 text-right space-x-1">
                      {slot.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(slot.id, "approved")}><Check className="h-3 w-3 mr-1" /> Approve</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => updateStatus(slot.id, "rejected")}><X className="h-3 w-3 mr-1" /> Reject</Button>
                        </>
                      )}
                      {slot.status === "approved" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(slot.id, "active")}>Activate</Button>
                      )}
                      {slot.status === "active" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(slot.id, "expired")}>Expire</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <h3 className="font-body font-semibold text-sm mb-4">Active Sponsored Slots</h3>
          {slots.filter(s => s.status === "active").length === 0 ? (
            <p className="text-muted-foreground text-sm">No active slots.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {slots.filter(s => s.status === "active").map(slot => (
                <Card key={slot.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-body">{slot.advertiser_name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Bid</span><span className="font-mono text-primary">${(slot.bid_amount_cents / 100).toLocaleString()}</span></div>
                    {slot.slot_start && <div className="flex justify-between"><span className="text-muted-foreground">Start</span><span>{new Date(slot.slot_start).toLocaleDateString()}</span></div>}
                    {slot.slot_end && <div className="flex justify-between"><span className="text-muted-foreground">End</span><span>{new Date(slot.slot_end).toLocaleDateString()}</span></div>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
