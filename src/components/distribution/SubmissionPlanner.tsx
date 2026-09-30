import { useState } from "react";
import { motion } from "framer-motion";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, FileText, Calendar, Target, Package } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  detail?: string;
}

interface ChecklistSection {
  title: string;
  icon: React.ReactNode;
  items: ChecklistItem[];
}

const MATERIALS: ChecklistItem[] = [
  { id: "mat-screenplay", label: "Final Draft Screenplay", detail: "Complete, proofread, properly formatted" },
  { id: "mat-pitch", label: "Pitch Deck / One-Pager", detail: "Synopsis, logline, comparables, team bios" },
  { id: "mat-lookbook", label: "Visual Lookbook", detail: "Mood boards, reference stills, tone guide" },
  { id: "mat-budget", label: "Budget Top-Sheet", detail: "High-level production cost estimate" },
  { id: "mat-schedule", label: "Preliminary Schedule", detail: "Shooting timeline estimate" },
  { id: "mat-screener", label: "Proof-of-Concept / Screener", detail: "Optional — short film or sizzle reel" },
];

const SECTIONS: ChecklistSection[] = [
  {
    title: "Target Identification",
    icon: <Target className="h-4 w-4 text-primary" />,
    items: [
      { id: "target-1", label: "Research matching distributors", detail: "Budget, genre, and release model alignment" },
      { id: "target-2", label: "Identify submission requirements", detail: "Each distributor has specific material needs" },
      { id: "target-3", label: "Build priority list (top 5–10)" },
    ],
  },
  {
    title: "Submission Timeline",
    icon: <Calendar className="h-4 w-4 text-amber-500" />,
    items: [
      { id: "timeline-1", label: "Research submission windows" },
      { id: "timeline-2", label: "Prepare festival submission calendar" },
      { id: "timeline-3", label: "Set outreach start date" },
      { id: "timeline-4", label: "Schedule follow-up reminders" },
    ],
  },
  {
    title: "Festival Plan",
    icon: <FileText className="h-4 w-4 text-blue-500" />,
    items: [
      { id: "fest-1", label: "Identify premiere-tier festivals", detail: "Sundance, TIFF, Venice, Cannes" },
      { id: "fest-2", label: "Identify backup festivals", detail: "SXSW, Tribeca, Berlin, Locarno" },
      { id: "fest-3", label: "Prepare festival screener" },
      { id: "fest-4", label: "Write festival programmer cover letter" },
    ],
  },
];

export default function SubmissionPlanner() {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalItems = SECTIONS.reduce((s, sec) => s + sec.items.length, 0) + MATERIALS.length;
  const completedItems = checked.size;
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Progress */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Submission Readiness</h2>
          <span className="text-lg font-bold font-mono">{progress}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8 }}
            className="h-full bg-primary rounded-full" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">{completedItems} of {totalItems} items completed</p>
      </motion.div>

      {/* Materials */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" /> Materials Checklist
        </h3>
        <div className="space-y-2">
          {MATERIALS.map(item => (
            <label key={item.id} className="flex items-start gap-3 py-1 cursor-pointer">
              <Checkbox checked={checked.has(item.id)} onCheckedChange={() => toggle(item.id)} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${checked.has(item.id) ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
                {item.detail && <p className="text-[10px] text-muted-foreground">{item.detail}</p>}
              </div>
            </label>
          ))}
        </div>
      </motion.div>

      {/* Other Sections */}
      {SECTIONS.map((section, i) => (
        <motion.div key={section.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + i * 0.1 }} className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            {section.icon} {section.title}
          </h3>
          <div className="space-y-2">
            {section.items.map(item => (
              <label key={item.id} className="flex items-start gap-3 py-1 cursor-pointer">
                <Checkbox checked={checked.has(item.id)} onCheckedChange={() => toggle(item.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className={`text-sm ${checked.has(item.id) ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
                  {item.detail && <p className="text-[10px] text-muted-foreground">{item.detail}</p>}
                </div>
              </label>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
