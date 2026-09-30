import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GripVertical, Trash2, Plus, Users, Coins } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface RoadmapFeature {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  sort_order: number;
  released_at: string | null;
  vote_count: number;
  token_total: number;
}

const STATUSES = ["planned", "in-progress", "testing", "released", "paused"];
const ROADMAP_DELETE_ON_HOLD = true;
const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  "in-progress": "In Progress",
  testing: "Testing",
  released: "Released",
  paused: "Paused",
};

function SortableFeatureRow({
  feature,
  onStatusChange,
  onDelete,
}: {
  feature: RoadmapFeature;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: feature.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-card/50">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium truncate">{feature.title}</p>
        {feature.description && <p className="text-xs text-muted-foreground truncate">{feature.description}</p>}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
        <Users className="h-3 w-3" /> {feature.vote_count}
        <Coins className="h-3 w-3 ml-2" /> {feature.token_total}
      </div>
      <Select value={feature.status} onValueChange={(v) => onStatusChange(feature.id, v)}>
        <SelectTrigger className="w-[130px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            disabled={ROADMAP_DELETE_ON_HOLD}
            title={ROADMAP_DELETE_ON_HOLD ? "Temporarily paused during a token security upgrade" : "Delete feature"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{feature.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the feature{feature.token_total > 0 ? ` and refund ${feature.token_total} tokens to ${feature.vote_count} user(s)` : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(feature.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function RoadmapPanel() {
  const [features, setFeatures] = useState<RoadmapFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  async function fetchFeatures() {
    const { data: roadmap } = await supabase
      .from("feature_roadmap")
      .select("id, title, description, status, target_date, sort_order, released_at")
      .order("sort_order", { ascending: true });

    const { data: votes } = await supabase
      .from("feature_votes")
      .select("feature_id, tokens_bid");

    const allVotes = votes || [];
    const enriched: RoadmapFeature[] = (roadmap || []).map((f) => {
      const fVotes = allVotes.filter((v) => v.feature_id === f.id);
      return {
        ...f,
        vote_count: fVotes.length,
        token_total: fVotes.reduce((s, v) => s + (v.tokens_bid || 0), 0),
      };
    });

    setFeatures(enriched);
    setLoading(false);
  }

  useEffect(() => { fetchFeatures(); }, []);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("feature_roadmap").insert({
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      target_date: newDate || null,
      sort_order: features.length,
    });
    if (error) {
      toast({ title: "Failed to add feature", description: error.message.includes("row-level security") ? "You need admin permissions to manage the roadmap." : error.message, variant: "destructive" });
    } else {
      setNewTitle("");
      setNewDesc("");
      setNewDate("");
    }
    await fetchFeatures();
    setAdding(false);
  }

  async function handleStatusChange(id: string, newStatus: string) {
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "released") {
      updates.released_at = new Date().toISOString();
    }
    await supabase.from("feature_roadmap").update(updates).eq("id", id);
    await fetchFeatures();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = features.findIndex((f) => f.id === active.id);
    const newIndex = features.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(features, oldIndex, newIndex);
    setFeatures(reordered);

    // Batch update sort_order for all affected items
    await Promise.all(
      reordered.map((f, idx) =>
        f.sort_order !== idx
          ? supabase.from("feature_roadmap").update({ sort_order: idx }).eq("id", f.id)
          : Promise.resolve()
      )
    );
    await fetchFeatures();
  }

  async function handleDelete(id: string) {
    if (ROADMAP_DELETE_ON_HOLD) {
      toast({
        title: "Roadmap deletion is temporarily paused",
        description: "Existing votes and token balances remain unchanged during the security upgrade.",
      });
      return;
    }
    const { data } = await supabase.rpc("refund_feature_tokens", { p_feature_id: id });
    await supabase.from("feature_roadmap").delete().eq("id", id);
    const refund = data as { tokens_refunded: number; users_refunded: number } | null;
    if (refund && refund.tokens_refunded > 0) {
      toast({ title: "Feature removed", description: `${refund.tokens_refunded} tokens refunded to ${refund.users_refunded} user(s).` });
    } else {
      toast({ title: "Feature removed" });
    }
    await fetchFeatures();
  }

  return (
    <Section>
      <SectionLabel>Feature Roadmap</SectionLabel>
      <SectionTitle>Manage Roadmap</SectionTitle>

      {/* Add form */}
      <div className="mt-6 p-4 rounded-xl border border-border/50 bg-card/80 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input placeholder="Feature title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Input placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <Input type="date" placeholder="Target date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </div>
        <Button onClick={handleAdd} disabled={adding || !newTitle.trim()} size="sm">
          <Plus className="h-3 w-3 mr-1" /> Add Feature
        </Button>
      </div>

      {/* List */}
      <div className="mt-6 space-y-2">
        {loading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
        ) : features.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No features added yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={features.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {features.map((f) => (
                <SortableFeatureRow
                  key={f.id}
                  feature={f}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </Section>
  );
}
