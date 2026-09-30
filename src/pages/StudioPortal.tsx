import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, Megaphone, Send, Loader2, DollarSign, Trophy, Calendar, FolderOpen } from "lucide-react";
import BatchUploadPanel from "@/components/studio/BatchUploadPanel";
import BatchResultsSummary from "@/components/studio/BatchResultsSummary";

import { motion } from "framer-motion";
import { format } from "date-fns";

type SponsorshipOffer = {
  id: string;
  festival_id: string | null;
  competition_id: string | null;
  offer_type: string;
  offer_amount_cents: number;
  message: string;
  status: string;
  created_at: string;
};

type AdBid = {
  id: string;
  festival_id: string | null;
  advertiser_name: string;
  advertiser_email: string;
  bid_amount_cents: number;
  notes: string;
  status: string;
  created_at: string;
};

type Festival = { id: string; title: string };
type Competition = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  active: "bg-primary/10 text-primary border-primary/20",
};

const OFFER_TYPES = [
  { value: "competition_sponsor", label: "Competition Sponsor" },
  { value: "event_sponsor", label: "Event Sponsor" },
  { value: "title_sponsor", label: "Title Sponsor" },
];

export default function StudioPortal() {
  const { user, loading: authLoading } = useAuth();
  const { plan, loading: subLoading } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);

  // Sponsorship form
  const [offerType, setOfferType] = useState("event_sponsor");
  const [offerFestivalId, setOfferFestivalId] = useState<string>("");
  const [offerCompetitionId, setOfferCompetitionId] = useState<string>("");
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offers, setOffers] = useState<SponsorshipOffer[]>([]);

  // Ad bid form
  const [bidName, setBidName] = useState("");
  const [bidEmail, setBidEmail] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [bidNotes, setBidNotes] = useState("");
  const [bidFestivalId, setBidFestivalId] = useState<string>("");
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bids, setBids] = useState<AdBid[]>([]);
  const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);


  // Redirect if not authed or not studio
  useEffect(() => {
    if (!authLoading && !subLoading) {
      if (!user) {
        navigate("/auth");
      }
    }
  }, [user, authLoading, subLoading, navigate]);

  // Load lookup data + user data
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [festRes, compRes] = await Promise.all([
        supabase.from("festivals").select("id, title").order("sort_order"),
        supabase.from("competitions").select("id, name").order("created_at", { ascending: false }),
      ]);
      if (festRes.data) setFestivals(festRes.data);
      if (compRes.data) setCompetitions(compRes.data);

      // Pre-fill email
      setBidEmail(user.email ?? "");

      refreshOffers();
      refreshBids();
    };
    load();
  }, [user]);

  async function refreshOffers() {
    if (!user) return;
    const { data } = await supabase
      .from("sponsorship_offers")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setOffers(data as SponsorshipOffer[]);
  }

  async function refreshBids() {
    if (!user) return;
    const { data } = await supabase
      .from("festival_ad_slots")
      .select("id, festival_id, advertiser_name, advertiser_email, bid_amount_cents, notes, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setBids(data as AdBid[]);
  }

  async function handleOfferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !offerAmount.trim()) return;
    setOfferSubmitting(true);

    const amountCents = Math.round(parseFloat(offerAmount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid dollar amount.", variant: "destructive" });
      setOfferSubmitting(false);
      return;
    }

    const { error } = await supabase.from("sponsorship_offers").insert({
      user_id: user.id,
      offer_type: offerType,
      festival_id: offerFestivalId || null,
      competition_id: offerCompetitionId || null,
      offer_amount_cents: amountCents,
      message: offerMessage.trim(),
      status: "pending",
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Offer submitted", description: "Your sponsorship proposal is pending admin review." });
      setOfferAmount("");
      setOfferMessage("");
      setOfferFestivalId("");
      setOfferCompetitionId("");
      refreshOffers();
    }
    setOfferSubmitting(false);
  }

  async function handleBidSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !bidName.trim() || !bidEmail.trim() || !bidAmount.trim()) return;
    setBidSubmitting(true);

    const amountCents = Math.round(parseFloat(bidAmount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid dollar amount.", variant: "destructive" });
      setBidSubmitting(false);
      return;
    }

    const { error } = await supabase.from("festival_ad_slots").insert({
      user_id: user.id,
      advertiser_name: bidName.trim(),
      advertiser_email: bidEmail.trim(),
      bid_amount_cents: amountCents,
      notes: bidNotes.trim(),
      festival_id: bidFestivalId || null,
      status: "pending",
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Bid submitted", description: "Your ad space bid is pending admin review." });
      setBidAmount("");
      setBidNotes("");
      setBidFestivalId("");
      refreshBids();
    }
    setBidSubmitting(false);
  }

  if (authLoading || subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const festivalLabel = (id: string | null) => {
    if (!id) return "—";
    return festivals.find((f) => f.id === id)?.title ?? id.slice(0, 8);
  };
  const competitionLabel = (id: string | null) => {
    if (!id) return "—";
    return competitions.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Studio Portal</h1>
          <p className="font-body text-sm text-muted-foreground">Submit sponsorship offers and bid on ad space</p>
        </div>
      </motion.div>

      <Tabs defaultValue="sponsorships" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="sponsorships" className="font-body gap-2">
            <Trophy className="h-4 w-4" /> Sponsorships
          </TabsTrigger>
          <TabsTrigger value="ads" className="font-body gap-2">
            <Megaphone className="h-4 w-4" /> Ad Bids
          </TabsTrigger>
          <TabsTrigger value="catalog" className="font-body gap-2">
            <FolderOpen className="h-4 w-4" /> Catalog Profiling
          </TabsTrigger>
        </TabsList>

        {/* ── Sponsorship Offers ── */}
        <TabsContent value="sponsorships" className="space-y-6 mt-6">
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleOfferSubmit}
            className="rounded-xl border border-border/50 bg-card p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-semibold">New Sponsorship Proposal</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Sponsorship Type</label>
                <Select value={offerType} onValueChange={setOfferType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OFFER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Offer Amount ($)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="500.00"
                    value={offerAmount}
                    onChange={(e) => setOfferAmount(e.target.value)}
                    className="pl-9 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Target Festival (optional)</label>
                <Select value={offerFestivalId} onValueChange={setOfferFestivalId}>
                  <SelectTrigger><SelectValue placeholder="Any / All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any / All</SelectItem>
                    {festivals.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Target Competition (optional)</label>
                <Select value={offerCompetitionId} onValueChange={setOfferCompetitionId}>
                  <SelectTrigger><SelectValue placeholder="Any / All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any / All</SelectItem>
                    {competitions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-body text-muted-foreground">Message / Pitch</label>
              <Textarea
                placeholder="Describe your sponsorship goals, brand alignment, and any specific requests…"
                value={offerMessage}
                onChange={(e) => setOfferMessage(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </div>

            <Button type="submit" disabled={offerSubmitting} className="gap-2">
              {offerSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Proposal
            </Button>
          </motion.form>

          {/* Offer History */}
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/30">
              <h3 className="font-display text-sm font-semibold">Your Sponsorship Offers</h3>
            </div>
            {offers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground font-body">No offers submitted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-body text-xs">Type</TableHead>
                    <TableHead className="font-body text-xs">Festival</TableHead>
                    <TableHead className="font-body text-xs">Competition</TableHead>
                    <TableHead className="font-body text-xs">Amount</TableHead>
                    <TableHead className="font-body text-xs">Status</TableHead>
                    <TableHead className="font-body text-xs">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-body text-sm capitalize">{o.offer_type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="font-body text-sm">{festivalLabel(o.festival_id)}</TableCell>
                      <TableCell className="font-body text-sm">{competitionLabel(o.competition_id)}</TableCell>
                      <TableCell className="font-mono text-sm">${(o.offer_amount_cents / 100).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize text-xs ${STATUS_COLORS[o.status] ?? ""}`}>
                          {o.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {format(new Date(o.created_at), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ── Ad Space Bids ── */}
        <TabsContent value="ads" className="space-y-6 mt-6">
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleBidSubmit}
            className="rounded-xl border border-border/50 bg-card p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-semibold">New Ad Space Bid</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Advertiser / Studio Name</label>
                <Input
                  placeholder="Your studio or brand name"
                  value={bidName}
                  onChange={(e) => setBidName(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Contact Email</label>
                <Input
                  type="email"
                  placeholder="studio@example.com"
                  value={bidEmail}
                  onChange={(e) => setBidEmail(e.target.value)}
                  required
                  maxLength={255}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Bid Amount ($)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="250.00"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    className="pl-9 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Target Festival (optional)</label>
                <Select value={bidFestivalId} onValueChange={setBidFestivalId}>
                  <SelectTrigger><SelectValue placeholder="Any / All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any / All</SelectItem>
                    {festivals.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-body text-muted-foreground">Notes (optional)</label>
              <Textarea
                placeholder="Preferred placement, campaign duration, creative assets you'd provide…"
                value={bidNotes}
                onChange={(e) => setBidNotes(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </div>

            <Button type="submit" disabled={bidSubmitting} className="gap-2">
              {bidSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Bid
            </Button>
          </motion.form>

          {/* Bid History */}
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/30">
              <h3 className="font-display text-sm font-semibold">Your Ad Space Bids</h3>
            </div>
            {bids.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground font-body">No bids submitted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-body text-xs">Advertiser</TableHead>
                    <TableHead className="font-body text-xs">Festival</TableHead>
                    <TableHead className="font-body text-xs">Bid</TableHead>
                    <TableHead className="font-body text-xs">Status</TableHead>
                    <TableHead className="font-body text-xs">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bids.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-body text-sm">{b.advertiser_name}</TableCell>
                      <TableCell className="font-body text-sm">{festivalLabel(b.festival_id)}</TableCell>
                      <TableCell className="font-mono text-sm">${(b.bid_amount_cents / 100).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize text-xs ${STATUS_COLORS[b.status] ?? ""}`}>
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {format(new Date(b.created_at), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ── Catalog Profiling ── */}
        <TabsContent value="catalog" className="space-y-6 mt-6">
          <BatchUploadPanel competitions={competitions} mode="studio" onJobSelected={setActiveBatchJobId} />
          {activeBatchJobId && <BatchResultsSummary batchJobId={activeBatchJobId} />}

        </TabsContent>
      </Tabs>
    </div>
  );
}
