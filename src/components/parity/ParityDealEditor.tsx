import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Globe, ShieldAlert, ShieldCheck, ArrowDown, ScrollText } from "lucide-react";
import { toast } from "sonner";
import ParityReservedRightsGrid from "./ParityReservedRightsGrid";
import ParityOtherAuditPanel from "./ParityOtherAuditPanel";
import type { ParityDeal } from "@/lib/parity/types";
import { JURISDICTIONS, getJurisdiction, OTHER_REQUIRED_FIELDS, resolveDealJurisdiction } from "@/lib/parity/jurisdictions";
import { isSupportedJurisdiction, validateParityDeal, getRulesForJurisdiction } from "@/lib/parity/validation";

interface Props {
  deal: ParityDeal;
  onChange: (patch: Partial<ParityDeal>) => void;
  onToggleRight: (right: any) => void;
}

function NumField({
  label, value, onChange, step = 1, suffix, id,
}: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string; id?: string }) {
  return (
    <div className="space-y-1.5" id={id}>
      <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="bg-background/40"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}

export default function ParityDealEditor({ deal, onChange, onToggleRight }: Props) {
  const poolSum = deal.pool_investor_tail_pct + deal.pool_creator_ip_pct + deal.pool_contributor_pct;
  const poolError = Math.abs(poolSum - 100) > 0.01;
  const j = getJurisdiction(deal.jurisdiction);
  const validation = validateParityDeal(deal);
  const jurisdictionRules = getRulesForJurisdiction(deal.jurisdiction).filter(
    // Only the jurisdiction-specific tail — drop the common ones already implied everywhere.
    (r) => !["pool-sum", "day-rate-positive", "hurdle-ge-1"].includes(r.id)
  );
  const passingRuleIds = new Set(
    jurisdictionRules.filter((r) => !r.check(deal)).map((r) => r.id)
  );

  const handleJurisdictionChange = (v: string) => {
    if (!isSupportedJurisdiction(v)) {
      toast.error(`Unsupported jurisdiction: ${v}`);
      return;
    }
    onChange({ jurisdiction: v });
  };

  const scrollToField = (fieldId: string) => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = el.querySelector("input, textarea, select, [tabindex='0']") as HTMLElement | null;
      if (input) input.focus();
    }
  };

  const allIssues = [
    ...validation.errors.map((e) => ({ ...e, severity: "error" as const })),
    ...validation.warnings.map((w) => ({ ...w, severity: "warning" as const })),
  ];

  return (
    <div className="space-y-8">

      {/* Validation Summary */}
      <section className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {validation.valid && validation.warnings.length === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            )}
            <h3 className="font-display text-sm font-semibold">
              {validation.valid && validation.warnings.length === 0
                ? "All checks passed"
                : `${validation.errors.length} error${validation.errors.length !== 1 ? "s" : ""}${validation.warnings.length > 0 ? `, ${validation.warnings.length} warning${validation.warnings.length !== 1 ? "s" : ""}` : ""}`}
            </h3>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            {j.label}
          </span>
        </div>

        {allIssues.length > 0 && (
          <ul className="space-y-1.5">
            {allIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => scrollToField(issue.field)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
                    issue.severity === "error"
                      ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                      : "bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                  }`}
                  title="Jump to field"
                >
                  <ArrowDown className="h-3 w-3 shrink-0" />
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {validation.valid && validation.warnings.length === 0 && (
          <p className="text-xs text-emerald-300">
            Jurisdiction profile is complete and all deal-level requirements are satisfied.
          </p>
        )}
      </section>


      {/* Jurisdiction */}
      <section className="space-y-3" id="jurisdiction">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h3 className="font-display text-base font-semibold">Jurisdiction</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Sets the governing law, residuals body, withholding-tax language and reserved-rights caveats used by the modeler and the exported PDF.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Deal region</Label>
            <Select value={deal.jurisdiction} onValueChange={handleJurisdictionChange}>
              <SelectTrigger className="bg-background/40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {JURISDICTIONS.map((p) => (
                  <SelectItem key={p.code} value={p.code}>{p.label} ({p.currencyCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Residuals body</Label>
            <div className="text-xs rounded-md border border-border/40 bg-background/30 px-3 py-2 leading-relaxed">
              {j.residualsBody}
            </div>
          </div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-1.5 text-xs">
          <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Governing law</span>{j.governingLaw}</div>
          <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Withholding</span>{j.withholdingNote}</div>
          <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">CAMA</span>{j.collectionAccountNote}</div>
        </div>

        {/* Per-jurisdiction required-field rule set */}
        {jurisdictionRules.length > 0 && (
          <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-2 text-xs">
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Required for {j.label}
            </div>
            <ul className="space-y-1">
              {jurisdictionRules.map((r) => {
                const pass = passingRuleIds.has(r.id);
                return (
                  <li key={r.id} className="flex items-start gap-2">
                    {pass ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                    ) : r.severity === "error" ? (
                      <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" />
                    )}
                    <button
                      type="button"
                      onClick={() => scrollToField(r.field)}
                      className={`text-left hover:underline ${pass ? "text-muted-foreground line-through" : r.severity === "error" ? "text-destructive" : "text-amber-300"}`}
                    >
                      {r.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Jurisdiction validation */}
        {validation.errors.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-destructive">
              <ShieldAlert className="h-3.5 w-3.5" /> Clause validation
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs flex items-center gap-1.5 text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> All required clauses are present for {j.label}.
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1 text-xs">
            <div className="font-medium text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Warnings
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {validation.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* Custom Jurisdiction Clauses — only when OTHER */}
      {deal.jurisdiction === "OTHER" && (
        <section className="space-y-3" id="other-jurisdiction">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h3 className="font-display text-base font-semibold">Custom Jurisdiction Clauses</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Because <span className="font-mono">Other / Custom</span> has no canned legal text, the modeler and PDF use the
            fields below verbatim. All are required before the draft agreement can be exported.
          </p>

          {/* Live checklist */}
          <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-1.5 text-xs">
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Custom-clause checklist
            </div>
            <ul className="space-y-1">
              {OTHER_REQUIRED_FIELDS.map((f) => {
                const filled = !!((deal as any)[f.key] ?? "").toString().trim();
                return (
                  <li key={f.key} className="flex items-start gap-2">
                    {filled ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                    )}
                    <button
                      type="button"
                      onClick={() => scrollToField(f.domId)}
                      className={`text-left hover:underline ${filled ? "text-muted-foreground line-through" : "text-destructive"}`}
                    >
                      {f.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2" id="other-governing-law">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Governing law</Label>
              <Textarea
                rows={2}
                value={deal.custom_governing_law ?? ""}
                onChange={(e) => onChange({ custom_governing_law: e.target.value })}
                placeholder="e.g. The laws of Singapore, without regard to conflict-of-laws principles."
                className="bg-background/40"
              />
            </div>
            <div className="space-y-1.5" id="other-forum">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Forum / exclusive jurisdiction</Label>
              <Input
                value={deal.custom_forum ?? ""}
                onChange={(e) => onChange({ custom_forum: e.target.value })}
                placeholder="e.g. Singapore International Commercial Court"
                className="bg-background/40"
              />
            </div>
            <div className="space-y-1.5" id="other-residuals-body">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Residuals body / collecting society</Label>
              <Input
                value={deal.custom_residuals_body ?? ""}
                onChange={(e) => onChange({ custom_residuals_body: e.target.value })}
                placeholder="e.g. COMPASS (Singapore) royalties where applicable"
                className="bg-background/40"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2" id="other-withholding">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Withholding-tax note</Label>
              <Textarea
                rows={2}
                value={deal.custom_withholding_note ?? ""}
                onChange={(e) => onChange({ custom_withholding_note: e.target.value })}
                placeholder="Local withholding, VAT/GST, treaty relief…"
                className="bg-background/40"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2" id="other-cama">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Collection-account (CAMA) note</Label>
              <Textarea
                rows={2}
                value={deal.custom_collection_account_note ?? ""}
                onChange={(e) => onChange({ custom_collection_account_note: e.target.value })}
                placeholder="Independent CAM, AML/KYC obligations, reporting cadence…"
                className="bg-background/40"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2" id="other-reserved-caveat">
              <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Reserved-rights caveat</Label>
              <Textarea
                rows={2}
                value={deal.custom_reserved_rights_caveat ?? ""}
                onChange={(e) => onChange({ custom_reserved_rights_caveat: e.target.value })}
                placeholder="Local moral-rights or statutory-royalty regime that survives the grant…"
                className="bg-background/40"
              />
            </div>
          </div>

          {/* Effective preview */}
          <div className="rounded-md border border-border/40 bg-background/30 p-3 space-y-1.5 text-xs">
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Effective clauses (used by PDF)
            </div>
            {(() => {
              const eff = resolveDealJurisdiction(deal);
              return (
                <>
                  <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Governing law</span>{eff.governingLaw}</div>
                  <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Residuals</span>{eff.residualsBody}</div>
                  <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Withholding</span>{eff.withholdingNote}</div>
                  <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">CAMA</span>{eff.collectionAccountNote}</div>
                  <div><span className="font-mono text-[10px] uppercase text-muted-foreground mr-2">Caveat</span>{eff.reservedRightsCaveat}</div>
                </>
              );
            })()}
          </div>

          {/* Audit trail */}
          <ParityOtherAuditPanel deal={deal} onJumpTo={scrollToField} />
        </section>
      )}




      {/* Parity Compensation */}
      <section className="space-y-3" id="parity-day-rate">
        <h3 className="font-display text-base font-semibold">Parity Compensation</h3>
        <p className="text-xs text-muted-foreground">
          Flat day rate paid to every covered participant — the moral spine of the Sing Sing model.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumField label="Parity day rate (USD)" value={deal.parity_day_rate_usd} onChange={(v) => onChange({ parity_day_rate_usd: v })} suffix="$" />
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">SAG tier note</Label>
            <Input
              value={deal.sag_tier_note ?? ""}
              onChange={(e) => onChange({ sag_tier_note: e.target.value })}
              placeholder="e.g. SAG Ultra Low Budget scale"
              className="bg-background/40"
            />
          </div>
        </div>
      </section>

      {/* Waterfall Config */}
      <section className="space-y-3" id="hurdle-multiple">
        <h3 className="font-display text-base font-semibold">Waterfall Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumField label="Investor capital" value={deal.investor_capital_usd} onChange={(v) => onChange({ investor_capital_usd: v })} suffix="$" />
          <NumField id="hurdle-multiple" label="Hurdle multiple" value={deal.hurdle_multiple} step={0.05} onChange={(v) => onChange({ hurdle_multiple: v })} suffix="x" />
          <NumField label="Deferred payroll" value={deal.deferred_payroll_usd} onChange={(v) => onChange({ deferred_payroll_usd: v })} suffix="$" />
          <NumField label="Distribution fee" value={deal.distribution_fee_pct} step={0.1} onChange={(v) => onChange({ distribution_fee_pct: v })} suffix="%" />
          <NumField label="Foreign sales commission" value={deal.foreign_sales_commission_pct} step={0.1} onChange={(v) => onChange({ foreign_sales_commission_pct: v })} suffix="%" />
          <NumField label="CAM fee" value={deal.cam_fee_pct} step={0.1} onChange={(v) => onChange({ cam_fee_pct: v })} suffix="%" />
          <NumField label="Modeled residuals" value={deal.residuals_pct} step={0.1} onChange={(v) => onChange({ residuals_pct: v })} suffix="%" />
          <NumField label="P&A cap" value={deal.pa_cap_usd} onChange={(v) => onChange({ pa_cap_usd: v })} suffix="$" />
          <NumField label="Approved overhead cap" value={deal.overhead_cap_usd} onChange={(v) => onChange({ overhead_cap_usd: v })} suffix="$" />
        </div>
        <div className="flex items-start gap-3 rounded-md border border-border/40 bg-background/30 p-3">
          <Switch checked={deal.cross_collateralize} onCheckedChange={(v) => onChange({ cross_collateralize: v })} />
          <div className="space-y-1">
            <Label className="text-sm">Cross-collateralize across media</Label>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
              When on, fees and expenses recoup against pooled revenues. The PDF flags this as a silent killer of contributor pools.
            </p>
          </div>
        </div>
      </section>

      {/* Pool Splits */}
      <section className="space-y-3" id="pool-splits">
        <h3 className="font-display text-base font-semibold">Net Profit Pool Splits</h3>
        <div className="grid grid-cols-3 gap-4">
          <NumField label="Investor Tail" value={deal.pool_investor_tail_pct} step={0.5} onChange={(v) => onChange({ pool_investor_tail_pct: v })} suffix="%" />
          <NumField label="Creator / IP Pool" value={deal.pool_creator_ip_pct} step={0.5} onChange={(v) => onChange({ pool_creator_ip_pct: v })} suffix="%" />
          <NumField label="Contributor Pool" value={deal.pool_contributor_pct} step={0.5} onChange={(v) => onChange({ pool_contributor_pct: v })} suffix="%" />
        </div>
        {poolError && (
          <p className="text-xs text-destructive">Pools must sum to 100% — currently {poolSum.toFixed(2)}%</p>
        )}
      </section>

      {/* Reserved Rights */}
      <section className="space-y-3" id="reserved-rights">
        <h3 className="font-display text-base font-semibold">Reserved Rights</h3>
        <p className="text-xs text-muted-foreground">
          Rights checked here are reserved to the Producer / IP pool and stay out of any distributor grant.
        </p>
        <ParityReservedRightsGrid value={deal.reserved_rights} onToggle={onToggleRight} jurisdiction={deal.jurisdiction} />
      </section>

      {/* Notes */}
      <section className="space-y-2" id="parity-notes">
        <Label className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Notes</Label>
        <Textarea
          rows={3}
          value={deal.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Deal context, side letters, special arrangements…"
          className="bg-background/40"
        />
      </section>
    </div>
  );
}
