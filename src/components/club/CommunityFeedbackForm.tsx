// Structured 4-axis review form with 30-word gate + AI-screening submit hook.
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Star } from "lucide-react";

export interface FeedbackPayload {
  ratings: Record<"story" | "characters" | "dialogue" | "engagement", number>;
  whatWorked: string;
  whatDidnt: string;
  oneImprovement: string;
}

interface Props {
  disabled?: boolean;
  onSubmit: (payload: FeedbackPayload) => Promise<void> | void;
  errors?: string[];
}

function wc(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function CommunityFeedbackForm({ disabled, onSubmit, errors = [] }: Props) {
  const [ratings, setRatings] = useState<FeedbackPayload["ratings"]>({
    story: 5, characters: 5, dialogue: 5, engagement: 5,
  });
  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidnt, setWhatDidnt] = useState("");
  const [oneImprovement, setOneImprovement] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await onSubmit({ ratings, whatWorked, whatDidnt, oneImprovement });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="font-semibold text-lg">Write Your Review</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Rate each dimension 1–10. Each text field requires at least 30 words.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(Object.keys(ratings) as Array<keyof typeof ratings>).map((key) => (
          <div key={key} className="space-y-1.5">
            <label className="text-xs font-medium capitalize text-muted-foreground">{key}</label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={1} max={10} value={ratings[key]}
                onChange={(e) => setRatings((p) => ({ ...p, [key]: Number(e.target.value) }))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-semibold tabular-nums w-5 text-right">{ratings[key]}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <Field label="What Worked" value={whatWorked} setValue={setWhatWorked} placeholder="Describe what the screenplay does well…" />
        <Field label="What Didn't Work" value={whatDidnt} setValue={setWhatDidnt} placeholder="What could be stronger…" />
        <Field label="One Improvement" value={oneImprovement} setValue={setOneImprovement} placeholder="If you could change one thing…" />
      </div>

      {errors.length > 0 && (
        <div className="mt-4 rounded border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-1">
            <AlertCircle className="h-3.5 w-3.5" /> Review needs work
          </div>
          <ul className="text-xs text-destructive/90 list-disc list-inside space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <Button
        onClick={handle}
        disabled={disabled || submitting}
        className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90"
        size="sm"
      >
        {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Star className="mr-1.5 h-3.5 w-3.5" />}
        {submitting ? "Screening review…" : "Submit Review"}
      </Button>
    </div>
  );
}

function Field({ label, value, setValue, placeholder }: { label: string; value: string; setValue: (v: string) => void; placeholder: string }) {
  const c = wc(value);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <span className={`text-[10px] tabular-nums ${c >= 30 ? "text-emerald-400" : "text-muted-foreground"}`}>
          {c}/30 words
        </span>
      </div>
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} rows={3} />
    </div>
  );
}
