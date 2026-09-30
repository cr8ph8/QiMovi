/**
 * ProfileCompletenessCard — shows how developed a writer's profile is.
 * Encouraging, neutral language. No gamification.
 */
import { CheckCircle2, Circle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ProfileCompletenessProps {
  hasDisplayName: boolean;
  hasPenName: boolean;
  hasAvatar: boolean;
  hasSubmission: boolean;
  hasPublicProject: boolean;
  /** At least one project has genre + logline filled */
  hasMetadata: boolean;
}

const STEPS: { key: keyof ProfileCompletenessProps; label: string }[] = [
  { key: "hasDisplayName", label: "Display name set" },
  { key: "hasPenName", label: "Pen name added" },
  { key: "hasAvatar", label: "Profile photo uploaded" },
  { key: "hasSubmission", label: "First project submitted" },
  { key: "hasPublicProject", label: "A project is publicly visible" },
  { key: "hasMetadata", label: "Project metadata filled (genre, logline)" },
];

export default function ProfileCompletenessCard(props: ProfileCompletenessProps) {
  const completed = STEPS.filter(s => props[s.key]).length;
  const pct = Math.round((completed / STEPS.length) * 100);

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-display font-semibold text-foreground">Profile Strength</p>
        <span className="text-xs font-mono text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <ul className="space-y-1.5 pt-1">
        {STEPS.map(step => (
          <li key={step.key} className="flex items-center gap-2 text-xs">
            {props[step.key] ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            )}
            <span className={props[step.key] ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
