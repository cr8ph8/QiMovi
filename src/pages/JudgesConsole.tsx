import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Crown, Gavel, ScrollText, Trophy, Settings2, CheckCircle2, Users, ListChecks, History, FileSpreadsheet, Film } from "lucide-react";
import { ScreeningsPanel } from "@/components/judges/ScreeningsPanel";
import { useEffect, useState as useStateExtra } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { CompetitionPicker } from "@/components/judges/CompetitionPicker";
import { RoleChip } from "@/components/judges/RoleChip";
import { QueuePanel } from "@/components/judges/QueuePanel";
import { RulesGuidelinesPanel } from "@/components/judges/RulesGuidelinesPanel";
import { AwardsPanel } from "@/components/judges/AwardsPanel";
import { JudgingModePanel } from "@/components/judges/JudgingModePanel";
import { FinalizePanel } from "@/components/judges/FinalizePanel";
import { LeadJudgeManager } from "@/components/judges/LeadJudgeManager";
import { AuditPanel } from "@/components/judges/AuditPanel";
import { BulkImportPanel } from "@/components/judges/BulkImportPanel";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useCompetitionJudges } from "@/hooks/useCompetitionJudges";
import { useAuth } from "@/hooks/useAuth";

export default function JudgesConsole() {
  const { isAdmin } = useAuth();
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const { isLead } = useCompetitionJudges(competitionId);
  const [kind, setKind] = useStateExtra<string>("screenplay");

  useEffect(() => {
    if (!competitionId) return;
    (async () => {
      const { data } = await supabase
        .from("competitions")
        .select("kind")
        .eq("id", competitionId)
        .maybeSingle();
      setKind((data?.kind as string) ?? "screenplay");
    })();
  }, [competitionId]);

  const canEdit = isLead || isAdmin;
  const isFilm = kind === "ai_film";

  return (
    <>
      <Navbar />
      <ErrorBoundary surface="judges-console" resetKey={competitionId ?? "none"}>
      <main className="container pt-24 pb-16 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">
                Judges Console
              </span>
              {competitionId && (
                <RoleChip role={isAdmin ? "admin" : isLead ? "lead" : "judge"} />
              )}
            </div>
            <h1 className="font-display text-4xl tracking-tight">
              Judging <span className="text-gradient-gold italic">Room</span>
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Lead Judges set the rules, awards, and judging mode and finalize scores.
              Judges review the queue and submit per-judge evaluations.
            </p>
          </div>
          <CompetitionPicker value={competitionId} onChange={setCompetitionId} />
        </div>

        {!competitionId ? (
          <Card className="p-8 bg-background/30 border-border/40 text-center text-muted-foreground">
            Select a competition to begin.
          </Card>
        ) : (
          <Tabs defaultValue="queue" className="w-full">
            <TabsList className="bg-background/40 border border-border/40 flex-wrap h-auto">
              <TabsTrigger value="queue"><ListChecks className="h-3.5 w-3.5 mr-1.5" />Queue</TabsTrigger>
              <TabsTrigger value="rules"><ScrollText className="h-3.5 w-3.5 mr-1.5" />Rules</TabsTrigger>
              <TabsTrigger value="awards"><Trophy className="h-3.5 w-3.5 mr-1.5" />Awards</TabsTrigger>
              <TabsTrigger value="mode"><Settings2 className="h-3.5 w-3.5 mr-1.5" />Mode</TabsTrigger>
              <TabsTrigger value="import" disabled={!canEdit}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Import
                {!canEdit && <Crown className="h-3 w-3 ml-1 text-primary/60" />}
              </TabsTrigger>
              <TabsTrigger value="finalize" disabled={!canEdit}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Finalize
                {!canEdit && <Crown className="h-3 w-3 ml-1 text-primary/60" />}
              </TabsTrigger>
              {isFilm && (
                <TabsTrigger value="screenings">
                  <Film className="h-3.5 w-3.5 mr-1.5" />Screenings
                </TabsTrigger>
              )}
              <TabsTrigger value="roster"><Users className="h-3.5 w-3.5 mr-1.5" />Roster</TabsTrigger>
              <TabsTrigger value="audit"><History className="h-3.5 w-3.5 mr-1.5" />Audit</TabsTrigger>
            </TabsList>
            {isFilm && (
              <TabsContent value="screenings" className="mt-4">
                <SectionFrame icon={Film} title="Screenings & Live Scoring" leadOnly={!canEdit}>
                  <ScreeningsPanel competitionId={competitionId} canEdit={canEdit} />
                </SectionFrame>
              </TabsContent>
            )}
            <TabsContent value="import" className="mt-4">
              <SectionFrame icon={FileSpreadsheet} title="Bulk Import Submissions" leadOnly={!canEdit}>
                <BulkImportPanel competitionId={competitionId} canEdit={canEdit} />
              </SectionFrame>
            </TabsContent>
            
            <TabsContent value="queue" className="mt-4">
              <QueuePanel competitionId={competitionId} canFinalize={canEdit} />
            </TabsContent>
            <TabsContent value="rules" className="mt-4">
              <SectionFrame icon={ScrollText} title="Rules & Guidelines" leadOnly={!canEdit}>
                <RulesGuidelinesPanel competitionId={competitionId} canEdit={canEdit} />
              </SectionFrame>
            </TabsContent>
            <TabsContent value="awards" className="mt-4">
              <SectionFrame icon={Trophy} title="Awards" leadOnly={!canEdit}>
                <AwardsPanel competitionId={competitionId} canEdit={canEdit} />
              </SectionFrame>
            </TabsContent>
            <TabsContent value="mode" className="mt-4">
              <SectionFrame icon={Settings2} title="Judging Mode & Setup" leadOnly={!canEdit}>
                <JudgingModePanel competitionId={competitionId} canEdit={canEdit} />
              </SectionFrame>
            </TabsContent>
            <TabsContent value="finalize" className="mt-4">
              {canEdit ? (
                <FinalizePanel competitionId={competitionId} />
              ) : (
                <LeadOnlyNotice />
              )}
            </TabsContent>
            <TabsContent value="roster" className="mt-4">
              <SectionFrame icon={Users} title="Judges Roster">
                <LeadJudgeManager competitionId={competitionId} canManage={canEdit} />
              </SectionFrame>
            </TabsContent>
            <TabsContent value="audit" className="mt-4">
              <SectionFrame icon={History} title="Audit Trail">
                <AuditPanel competitionId={competitionId} />
              </SectionFrame>
            </TabsContent>
          </Tabs>
        )}
      </main>
      </ErrorBoundary>
    </>
  );
}

function SectionFrame({
  icon: Icon,
  title,
  leadOnly,
  children,
}: {
  icon: typeof Crown;
  title: string;
  leadOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6 bg-background/40 border-border/40 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="font-display text-xl">{title}</h2>
        </div>
        {leadOnly && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Gavel className="h-3 w-3" /> Read-only for Judges
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

function LeadOnlyNotice() {
  return (
    <Card className="p-8 bg-amber-500/5 border-amber-500/30 text-center">
      <Crown className="h-8 w-8 text-primary mx-auto mb-3" />
      <div className="font-display text-lg">Lead Judges only</div>
      <p className="text-sm text-muted-foreground mt-2">
        Only a Lead Judge for this competition can finalize entry scores.
      </p>
    </Card>
  );
}
