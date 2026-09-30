import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ClipboardCheck, Send, MessageSquare, ChevronDown, Eye, EyeOff, Clock,
  CheckCircle2, XCircle, AlertCircle, User, Pencil,
} from "lucide-react";
import { format } from "date-fns";

type ReviewStatus = "requested" | "in_review" | "completed" | "declined";
type ReviewVisibility = "author_only" | "collaborators" | "admin_only";

interface ReviewRequest {
  id: string;
  entry_id: string;
  version_id: string | null;
  requested_by: string;
  reviewer_id: string;
  reviewer_type: string;
  status: ReviewStatus;
  message: string;
  created_at: string;
  reviewer_name?: string;
}

interface StructuredReview {
  id: string;
  entry_id: string;
  version_id: string | null;
  review_request_id: string | null;
  reviewer_id: string;
  strengths: string;
  concerns: string;
  clarity_signals: string;
  narrative_observations: string;
  overall_notes: string;
  visibility: ReviewVisibility;
  created_at: string;
  reviewer_name?: string;
}

interface Collaborator {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
}

interface Props {
  entryId: string;
  entryUserId: string;
  currentVersionId?: string | null;
  draftNumber?: number;
}

const STATUS_META: Record<ReviewStatus, { icon: React.ElementType; label: string; className: string }> = {
  requested: { icon: Clock, label: "Requested", className: "border-amber-500/30 text-amber-400" },
  in_review: { icon: Pencil, label: "In Review", className: "border-blue-500/30 text-blue-400" },
  completed: { icon: CheckCircle2, label: "Completed", className: "border-emerald-500/30 text-emerald-400" },
  declined: { icon: XCircle, label: "Declined", className: "border-destructive/30 text-destructive" },
};

const VISIBILITY_LABELS: Record<ReviewVisibility, string> = {
  author_only: "Author Only",
  collaborators: "Collaborators",
  admin_only: "Admin Only",
};

export default function ReviewWorkflowPanel({ entryId, entryUserId, currentVersionId, draftNumber }: Props) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [reviews, setReviews] = useState<StructuredReview[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);

  // Request form
  const [selectedReviewer, setSelectedReviewer] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Review form (for reviewers)
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({
    strengths: "",
    concerns: "",
    clarity_signals: "",
    narrative_observations: "",
    overall_notes: "",
    visibility: "author_only" as ReviewVisibility,
  });
  const [submittingReview, setSubmittingReview] = useState(false);

  const isOwner = user?.id === entryUserId;
  const isReviewer = requests.some((r) => r.reviewer_id === user?.id && r.status !== "completed" && r.status !== "declined");

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch collaborators for the invite dropdown
    const { data: collabs } = await supabase
      .from("project_collaborators")
      .select("user_id, role")
      .eq("entry_id", entryId);

    if (collabs && collabs.length > 0) {
      const uids = collabs.map((c) => c.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, email")
        .in("user_id", uids);
      const pMap = new Map(profiles?.map((p) => [p.user_id, p]) || []);
      setCollaborators(
        collabs.map((c) => ({
          user_id: c.user_id,
          role: c.role,
          display_name: pMap.get(c.user_id)?.display_name || null,
          email: pMap.get(c.user_id)?.email || null,
        }))
      );
    } else {
      setCollaborators([]);
    }

    // Fetch review requests
    const { data: reqs } = await supabase
      .from("review_requests")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false });

    if (reqs && reqs.length > 0) {
      const reviewerIds = [...new Set(reqs.map((r: any) => r.reviewer_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", reviewerIds);
      const nMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) || []);
      setRequests(
        reqs.map((r: any) => ({ ...r, reviewer_name: nMap.get(r.reviewer_id) || "Unknown" }))
      );
    } else {
      setRequests([]);
    }

    // Fetch structured reviews
    const { data: revs } = await supabase
      .from("structured_reviews")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false });

    if (revs && revs.length > 0) {
      const reviewerIds = [...new Set(revs.map((r: any) => r.reviewer_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", reviewerIds);
      const nMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) || []);
      setReviews(
        revs.map((r: any) => ({ ...r, reviewer_name: nMap.get(r.reviewer_id) || "Unknown" }))
      );
    } else {
      setReviews([]);
    }

    setLoading(false);
  }, [entryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSendRequest = async () => {
    if (!selectedReviewer || !user) return;
    setSending(true);

    const { error } = await supabase.from("review_requests").insert({
      entry_id: entryId,
      version_id: currentVersionId || null,
      requested_by: user.id,
      reviewer_id: selectedReviewer,
      reviewer_type: "collaborator",
      message: requestMessage,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Log collab event
      await supabase.from("collaboration_events").insert({
        entry_id: entryId,
        actor_id: user.id,
        event_type: "review_requested",
        metadata: { reviewer_id: selectedReviewer, draft_number: draftNumber },
      });
      toast({ title: "Review requested" });
      setRequestMessage("");
      setSelectedReviewer("");
      fetchData();
    }
    setSending(false);
  };

  const handleAcceptRequest = async (reqId: string) => {
    await supabase.from("review_requests").update({ status: "in_review" } as any).eq("id", reqId);
    if (user) {
      await supabase.from("collaboration_events").insert({
        entry_id: entryId,
        actor_id: user.id,
        event_type: "review_accepted",
        metadata: { request_id: reqId },
      });
    }
    toast({ title: "Review accepted" });
    fetchData();
  };

  const handleDeclineRequest = async (reqId: string) => {
    await supabase.from("review_requests").update({ status: "declined" } as any).eq("id", reqId);
    toast({ title: "Review declined" });
    fetchData();
  };

  const handleSubmitReview = async () => {
    if (!user || !activeRequestId) return;
    setSubmittingReview(true);

    const req = requests.find((r) => r.id === activeRequestId);

    const { error } = await supabase.from("structured_reviews").insert({
      entry_id: entryId,
      version_id: req?.version_id || currentVersionId || null,
      review_request_id: activeRequestId,
      reviewer_id: user.id,
      ...reviewForm,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Mark request completed
      await supabase.from("review_requests").update({ status: "completed" } as any).eq("id", activeRequestId);
      await supabase.from("collaboration_events").insert({
        entry_id: entryId,
        actor_id: user.id,
        event_type: "review_submitted",
        metadata: { request_id: activeRequestId, visibility: reviewForm.visibility },
      });
      toast({ title: "Review submitted" });
      setActiveRequestId(null);
      setReviewForm({ strengths: "", concerns: "", clarity_signals: "", narrative_observations: "", overall_notes: "", visibility: "author_only" });
      fetchData();
    }
    setSubmittingReview(false);
  };

  if (loading) return <p className="text-xs text-muted-foreground py-2">Loading reviews…</p>;

  const pendingForMe = requests.filter((r) => r.reviewer_id === user?.id && (r.status === "requested" || r.status === "in_review"));

  return (
    <div className="space-y-6">
      {/* ── Request Review (Owner) ── */}
      {isOwner && collaborators.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" /> Request Review
          </h4>
          <div className="space-y-2">
            <Select value={selectedReviewer} onValueChange={setSelectedReviewer}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="Select reviewer…" />
              </SelectTrigger>
              <SelectContent>
                {collaborators
                  .filter((c) => c.role === "reviewer" || c.role === "editor")
                  .map((c) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      {c.display_name || c.email || "User"} ({c.role})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Optional message for the reviewer…"
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              className="text-xs min-h-[60px]"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {currentVersionId ? `Attached to Draft ${draftNumber || "current"}` : "No version linked"}
              </span>
              <Button size="sm" className="h-7 text-xs" onClick={handleSendRequest} disabled={sending || !selectedReviewer}>
                {sending ? "Sending…" : "Send Request"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isOwner && collaborators.length === 0 && (
        <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          Add collaborators with reviewer or editor roles to request reviews.
        </div>
      )}

      {/* ── Pending Review Requests (for reviewer) ── */}
      {pendingForMe.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" /> Your Pending Reviews
            </h4>
            {pendingForMe.map((req) => {
              const sm = STATUS_META[req.status];
              const Icon = sm.icon;
              return (
                <div key={req.id} className="rounded-lg border border-border/50 p-3 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className={`text-[10px] ${sm.className}`}>
                      <Icon className="h-3 w-3 mr-1" /> {sm.label}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {format(new Date(req.created_at), "MMM d, HH:mm")}
                    </span>
                  </div>
                  {req.message && <p className="text-xs text-muted-foreground mb-2">{req.message}</p>}
                  {req.status === "requested" && (
                    <div className="flex gap-2">
                      <Button size="sm" className="h-6 text-[10px]" onClick={() => handleAcceptRequest(req.id)}>Accept</Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleDeclineRequest(req.id)}>Decline</Button>
                    </div>
                  )}
                  {req.status === "in_review" && !activeRequestId && (
                    <Button size="sm" className="h-6 text-[10px]" onClick={() => setActiveRequestId(req.id)}>
                      <Pencil className="h-3 w-3 mr-1" /> Write Review
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Review Form ── */}
      {activeRequestId && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" /> Write Review
            </h4>
            <div className="space-y-3">
              {([
                { key: "strengths", label: "Strengths", placeholder: "What works well in this draft…" },
                { key: "concerns", label: "Concerns", placeholder: "Areas that may need attention…" },
                { key: "clarity_signals", label: "Clarity Signals", placeholder: "How clear is the narrative intent…" },
                { key: "narrative_observations", label: "Narrative Observations", placeholder: "Structural or thematic observations…" },
                { key: "overall_notes", label: "Overall Notes", placeholder: "Any additional thoughts…" },
              ] as const).map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
                  <Textarea
                    placeholder={placeholder}
                    value={reviewForm[key]}
                    onChange={(e) => setReviewForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="text-xs min-h-[50px]"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Visibility</label>
                <Select
                  value={reviewForm.visibility}
                  onValueChange={(v) => setReviewForm((f) => ({ ...f, visibility: v as ReviewVisibility }))}
                >
                  <SelectTrigger className="text-xs h-8 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="author_only">Author Only</SelectItem>
                    <SelectItem value="collaborators">All Collaborators</SelectItem>
                    <SelectItem value="admin_only">Admin Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="text-xs" onClick={handleSubmitReview} disabled={submittingReview}>
                  {submittingReview ? "Submitting…" : "Submit Review"}
                </Button>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setActiveRequestId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Request History (Owner/Admin) ── */}
      {(isOwner || isAdmin) && requests.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> Review Requests
              <Badge variant="secondary" className="text-[10px]">{requests.length}</Badge>
            </h4>
            <div className="space-y-1">
              {requests.map((req) => {
                const sm = STATUS_META[req.status];
                const Icon = sm.icon;
                return (
                  <div key={req.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/20">
                    <Icon className={`h-3.5 w-3.5 ${sm.className.split(" ").pop()}`} />
                    <span className="text-xs flex-1 truncate">{req.reviewer_name}</span>
                    <Badge variant="outline" className={`text-[9px] ${sm.className}`}>{sm.label}</Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {format(new Date(req.created_at), "MMM d")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Submitted Reviews ── */}
      {reviews.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" /> Reviews
              <Badge variant="secondary" className="text-[10px]">{reviews.length}</Badge>
            </h4>
            <div className="space-y-3">
              {reviews.map((rev) => (
                <Collapsible key={rev.id}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{rev.reviewer_name}</span>
                        <Badge variant="outline" className="text-[9px]">
                          {rev.visibility === "author_only" ? <EyeOff className="h-2.5 w-2.5 mr-0.5" /> : <Eye className="h-2.5 w-2.5 mr-0.5" />}
                          {VISIBILITY_LABELS[rev.visibility]}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {format(new Date(rev.created_at), "MMM d, yyyy")}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border border-border/30 border-t-0 rounded-b-lg p-4 space-y-3">
                      {rev.strengths && (
                        <div>
                          <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">Strengths</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{rev.strengths}</p>
                        </div>
                      )}
                      {rev.concerns && (
                        <div>
                          <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">Concerns</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{rev.concerns}</p>
                        </div>
                      )}
                      {rev.clarity_signals && (
                        <div>
                          <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wide">Clarity Signals</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{rev.clarity_signals}</p>
                        </div>
                      )}
                      {rev.narrative_observations && (
                        <div>
                          <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">Narrative Observations</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{rev.narrative_observations}</p>
                        </div>
                      )}
                      {rev.overall_notes && (
                        <div>
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Overall Notes</span>
                          <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{rev.overall_notes}</p>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </div>
        </>
      )}

      {!isOwner && !isReviewer && reviews.length === 0 && requests.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No review activity for this project.</p>
      )}
    </div>
  );
}
