import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Users, GitMerge, RotateCcw } from "lucide-react";
import { LENGTH_CATEGORIES } from "@/lib/wallet";

export type JudgingMode = "ai_only" | "human_only" | "hybrid";

/** Per-mode override — undefined value means "inherit from base". */
export type ModeOverrides = Partial<Record<string, number | null>>;

/** Structured fee rules stored inside competition_economics.entry_fees. */
export interface FeeRules {
  /** Base fee per category (fallback for all modes). */
  base: Record<string, number>;
  /** Optional per-mode overrides — sparse map, only categories that differ. */
  by_mode?: Partial<Record<JudgingMode, ModeOverrides>>;
}

interface Props {
  value: FeeRules;
  onChange: (next: FeeRules) => void;
  /** Selected mode drives visual highlight and the "effective fee" preview. */
  activeMode?: JudgingMode;
  disabled?: boolean;
}

const MODE_META: Record<JudgingMode, { label: string; Icon: typeof Bot; description: string }> = {
  ai_only:    { label: "AI-only",    Icon: Bot,      description: "Scores generated exclusively by the AI panel." },
  human_only: { label: "Human-only", Icon: Users,    description: "Scores generated exclusively by human judges." },
  hybrid:     { label: "Hybrid",     Icon: GitMerge, description: "Blended AI + human panel with median consensus." },
};

const MODES: JudgingMode[] = ["ai_only", "human_only", "hybrid"];

/** Normalize an incoming `entry_fees` JSON blob into FeeRules. */
export function normalizeFeeRules(raw: any): FeeRules {
  const defaults = Object.fromEntries(LENGTH_CATEGORIES.map((c) => [c.key, c.cost]));
  if (raw && typeof raw === "object" && raw.base && typeof raw.base === "object") {
    return {
      base: { ...defaults, ...(raw.base as Record<string, number>) },
      by_mode: raw.by_mode ?? {},
    };
  }
  // Legacy flat shape → treat as base.
  return { base: { ...defaults, ...(raw ?? {}) }, by_mode: {} };
}

/** Resolve the effective fee for a category under a given mode. */
export function resolveEffectiveFee(rules: FeeRules, category: string, mode: JudgingMode): number {
  const override = rules.by_mode?.[mode]?.[category];
  if (typeof override === "number") return override;
  return rules.base[category] ?? 0;
}

/**
 * Structured editor for competition fee rules across AI-only, Human-only, and
 * Hybrid judging modes. Base fees are always required; per-mode overrides are
 * sparse — leaving a cell blank inherits the base value.
 */
export function CompetitionFeeRulesEditor({ value, onChange, activeMode, disabled }: Props) {
  const rules = value;

  const setBase = (cat: string, n: number) => {
    onChange({ ...rules, base: { ...rules.base, [cat]: n } });
  };

  const setOverride = (mode: JudgingMode, cat: string, raw: string) => {
    const trimmed = raw.trim();
    const next = { ...(rules.by_mode ?? {}) };
    const bucket = { ...(next[mode] ?? {}) };
    if (trimmed === "") {
      delete bucket[cat];
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n >= 0) bucket[cat] = n;
    }
    if (Object.keys(bucket).length === 0) {
      delete next[mode];
    } else {
      next[mode] = bucket;
    }
    onChange({ ...rules, by_mode: next });
  };

  const clearMode = (mode: JudgingMode) => {
    const next = { ...(rules.by_mode ?? {}) };
    delete next[mode];
    onChange({ ...rules, by_mode: next });
  };

  const overrideCount = useMemo(() => {
    const out: Record<JudgingMode, number> = { ai_only: 0, human_only: 0, hybrid: 0 };
    for (const m of MODES) out[m] = Object.keys(rules.by_mode?.[m] ?? {}).length;
    return out;
  }, [rules]);

  return (
    <div className="p-3 rounded-lg border border-border/40 bg-card/60 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">Fee Rules · by Judging Mode</Label>
        {activeMode && (
          <Badge variant="outline" className="text-[9px] font-mono bg-primary/10 text-primary">
            Active: {MODE_META[activeMode].label}
          </Badge>
        )}
      </div>

      <Tabs defaultValue={activeMode ?? "ai_only"}>
        <TabsList className="grid grid-cols-4 h-8">
          <TabsTrigger value="base" className="text-[10px]">Base</TabsTrigger>
          {MODES.map((m) => {
            const Icon = MODE_META[m].Icon;
            return (
              <TabsTrigger key={m} value={m} className="text-[10px] gap-1">
                <Icon className="h-3 w-3" />
                {MODE_META[m].label}
                {overrideCount[m] > 0 && (
                  <span className="ml-1 px-1 rounded bg-primary/20 text-primary text-[9px]">
                    {overrideCount[m]}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Base fees */}
        <TabsContent value="base" className="mt-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-mono h-8 px-2">Category</TableHead>
                  <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Base fee (⊘)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LENGTH_CATEGORIES.map((cat) => (
                  <TableRow key={cat.key}>
                    <TableCell className="text-xs px-2 py-1.5 font-medium">{cat.label}</TableCell>
                    <TableCell className="px-2 py-1.5 text-center">
                      <Input
                        type="number"
                        min={0}
                        value={rules.base[cat.key] ?? 0}
                        disabled={disabled}
                        onChange={(e) => setBase(cat.key, Number(e.target.value) || 0)}
                        className="w-24 h-7 text-center text-xs mx-auto"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2">
            Base fees apply to every mode unless overridden below.
          </p>
        </TabsContent>

        {/* Per-mode overrides */}
        {MODES.map((mode) => (
          <TabsContent key={mode} value={mode} className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">{MODE_META[mode].description}</p>
              {overrideCount[mode] > 0 && !disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                  onClick={() => clearMode(mode)}
                >
                  <RotateCcw className="h-3 w-3" /> Reset overrides
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] font-mono h-8 px-2">Category</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Base</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Override (⊘)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 px-2 text-center">Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LENGTH_CATEGORIES.map((cat) => {
                    const base = rules.base[cat.key] ?? 0;
                    const override = rules.by_mode?.[mode]?.[cat.key];
                    const effective = typeof override === "number" ? override : base;
                    const overridden = typeof override === "number";
                    return (
                      <TableRow key={cat.key}>
                        <TableCell className="text-xs px-2 py-1.5 font-medium">{cat.label}</TableCell>
                        <TableCell className="text-[11px] px-2 py-1.5 text-center text-muted-foreground font-mono">
                          {base}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-center">
                          <Input
                            type="number"
                            min={0}
                            placeholder="—"
                            value={overridden ? String(override) : ""}
                            disabled={disabled}
                            onChange={(e) => setOverride(mode, cat.key, e.target.value)}
                            className="w-24 h-7 text-center text-xs mx-auto"
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-center">
                          <span
                            className={
                              "text-xs font-mono " +
                              (overridden ? "text-primary font-semibold" : "text-muted-foreground")
                            }
                          >
                            {effective}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-[9px] text-muted-foreground">
              Leave override blank to inherit the base fee. Values are per-event and stored on this competition only.
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
