import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createExportDoc } from "@/lib/pdf/pdfRenderer";
import { TIER_LABELS } from "@/lib/parity/defaults";
import { RESERVED_RIGHT_LABELS } from "@/lib/parity/types";
import { resolveDealJurisdiction } from "@/lib/parity/jurisdictions";
import { validateParityDeal } from "@/lib/parity/validation";
import { computeWaterfall, computeThresholds, formatUSD } from "@/lib/parity/waterfall";
import type { ParityDeal, ParityParticipant } from "@/lib/parity/types";

interface Props {
  deal: ParityDeal;
  participants: ParityParticipant[];
  contextLabel?: string;
}

export default function ParityAgreementExport({ deal, participants, contextLabel }: Props) {
  const [busy, setBusy] = useState(false);
  const validation = validateParityDeal(deal);

  const generate = async () => {
    const v = validateParityDeal(deal);
    if (!v.valid) {
      toast.error(v.errors[0]?.message ?? "Deal is missing required clauses for the selected jurisdiction.");
      return;
    }
    setBusy(true);
    try {
      const j = resolveDealJurisdiction(deal);
      const subtitleBits = [
        `Sing Sing-style deal schedule — DRAFT · Jurisdiction: ${j.label}`,
        contextLabel,
      ].filter(Boolean) as string[];
      const exportDoc = createExportDoc({
        unit: "pt",
        format: "letter",
        cover: {
          eyebrow: "Parity Deal",
          title: "Parity Profit Participation",
          subtitle: subtitleBits.join(" · "),
        },
        footerBrand: "DRAFT — not legal advice · Consult an entertainment attorney",
        evidence: {
          label: `parity_deal_${j.code.toLowerCase()}`,
          generatedAt: new Date().toISOString().slice(0, 10),
        },
      });
      const { doc } = exportDoc;
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 54;
      let y = Math.max(exportDoc.startY, margin);

      // Disclaimer stamp under the band, in muted grey.
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(
        `Generated ${new Date().toLocaleDateString()} · For modeling and discussion only · Not legal advice`,
        margin,
        y,
      );
      y += 22;
      doc.setTextColor(30);

      const writeHeading = (text: string, size = 14) => {
        if (y > 720) { doc.addPage(); y = margin; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(size);
        doc.setTextColor(30);
        doc.text(text, margin, y);
        y += size + 8;
      };
      const writePara = (text: string) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(30);
        const lines = doc.splitTextToSize(text, pageW - margin * 2);
        lines.forEach((ln: string) => {
          if (y > 750) { doc.addPage(); y = margin; }
          doc.text(ln, margin, y);
          y += 13;
        });
        y += 4;
      };
      const writeRow = (label: string, value: string) => {
        if (y > 750) { doc.addPage(); y = margin; }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(30);
        doc.text(label, margin, y);
        doc.text(value, pageW - margin, y, { align: "right" });
        y += 14;
      };



      // Parity comp
      writeHeading("1. Parity Compensation");
      writePara(
        `All covered Participants shall be paid a flat day rate of ${formatUSD(deal.parity_day_rate_usd)} USD (settled in ${j.currencyLabel} where applicable) per working day, regardless of role. ${deal.sag_tier_note ? "Reference scale: " + deal.sag_tier_note + ". " : ""}${j.withholdingNote}`,
      );

      // Definitions
      writeHeading("2. Definitions");
      writePara("\"Gross Receipts\" means monies actually received and collected from exploitation, less only refunds, withholding taxes paid at source, and documented trade discounts.");
      writePara(`\"Adjusted Gross Receipts\" means Gross Receipts less the distribution fee, foreign sales commission, CAM fee, capped P&A, capped approved overhead, and modeled residuals (including ${j.residualsBody}) defined below.`);
      writePara("\"Net Profit Pool\" means Adjusted Gross Receipts after investor senior recoupment and payment of deferred payroll.");


      // Waterfall
      writeHeading("3. Waterfall Configuration");
      writeRow("Investor capital", formatUSD(deal.investor_capital_usd));
      writeRow("Hurdle multiple", `${deal.hurdle_multiple}x`);
      writeRow("Distribution fee", `${deal.distribution_fee_pct}%`);
      writeRow("Foreign sales commission", `${deal.foreign_sales_commission_pct}%`);
      writeRow("CAM fee", `${deal.cam_fee_pct}%`);
      writeRow("Modeled residuals", `${deal.residuals_pct}%`);
      writeRow("P&A cap", formatUSD(deal.pa_cap_usd));
      writeRow("Approved overhead cap", formatUSD(deal.overhead_cap_usd));
      writeRow("Deferred payroll", formatUSD(deal.deferred_payroll_usd));
      writeRow("Cross-collateralized", deal.cross_collateralize ? "Yes" : "No");
      y += 6;

      // Pools
      writeHeading("4. Net Profit Pool Splits");
      writeRow("Investor Tail", `${deal.pool_investor_tail_pct}%`);
      writeRow("Creator / IP Pool", `${deal.pool_creator_ip_pct}%`);
      writeRow("Contributor Pool", `${deal.pool_contributor_pct}%`);
      y += 6;

      // Thresholds
      writeHeading("5. Break-Even Thresholds (modeled)");
      const t = computeThresholds(deal);
      writeRow("Investor principal recouped", formatUSD(t.principalRecouped));
      writeRow(`Full ${deal.hurdle_multiple}x hurdle hit`, formatUSD(t.fullHurdleHit));
      writeRow("Contributor pool opens", formatUSD(t.contributorPoolOpens));
      y += 6;

      // Reserved rights
      writeHeading("6. Reserved Rights");
      if (deal.reserved_rights.length === 0) {
        writePara("No rights expressly reserved. Producer should consider reserving transmedia rights from any distribution grant.");
      } else {
        writePara("The following rights are reserved exclusively to Producer and the Creator/IP Pool and shall not be swept into any distribution grant:");
        deal.reserved_rights.forEach((r) => {
          if (y > 750) { doc.addPage(); y = margin; }
          const label = j.rightsTermOverrides?.[r] ?? RESERVED_RIGHT_LABELS[r];
          doc.text(`  •  ${label}`, margin, y); y += 13;
        });
        y += 4;
        writePara(j.reservedRightsCaveat);
      }

      // Participants
      writeHeading("7. Schedule of Participants");
      const totalUnits = participants.reduce((s, p) => s + p.unit_weight, 0);
      if (participants.length === 0) {
        writePara("No participants enrolled yet.");
      } else {
        writeRow("Name", "Tier · Units");
        participants.forEach((p) => {
          writeRow(p.display_name_override ?? "—", `${TIER_LABELS[p.role_tier]} · ${p.unit_weight}u`);
        });
        writeRow("Total units", String(totalUnits));
      }
      y += 6;

      // CAMA + sequels
      writeHeading("8. Collection Account (CAMA)");
      writePara(`Producer shall establish and maintain a Collection Account Management Agreement naming all senior financial participants and approved profit participants as beneficiaries. All distributors, sales agents, licensees and sublicensors shall remit receipts directly to the Collection Account Manager. The CAMA waterfall controls all disbursements. ${j.collectionAccountNote}`);

      writeHeading("9. Sequels and Franchise Rights");
      writePara("No Participant acquires any ownership or approval right in any sequel, prequel, remake, spin-off, television adaptation, game, podcast, live event, publication, or other derivative production by reason of this Agreement. All such rights are reserved exclusively to Producer and the Creator/IP Pool.");

      writeHeading("10. Governing Law & Jurisdiction");
      writePara(j.governingLaw);

      // Notes
      if (deal.notes) {
        writeHeading("11. Notes");
        writePara(deal.notes);
      }


      // Shared evidence footer on every page (brand + page counter)
      exportDoc.finalizeEvidenceFooters();

      doc.save(`parity-deal-${(contextLabel ?? "draft").replace(/\W+/g, "-").toLowerCase()}-${j.code.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("Draft agreement downloaded");
    } catch (e) {
      toast.error("Export failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Quick preview of moderate scenario
  const moderate = computeWaterfall(deal, 6_200_000);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/40 bg-background/30 p-4 space-y-2">
        <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">Draft Agreement Export</div>
        <p className="text-sm">
          Generates a Cinema Aurea-styled PDF schedule covering parity comp, waterfall config, pool splits, reserved rights, the participant unit table, CAMA and sequels clauses.
        </p>
        <p className="text-[10px] text-muted-foreground">
          Stamped <span className="font-mono">DRAFT — not legal advice</span> on every page.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <Mini label="Investor tail (mod.)" value={formatUSD(moderate.investorTail)} />
        <Mini label="Creator/IP (mod.)" value={formatUSD(moderate.creatorIpPool)} />
        <Mini label="Contributor (mod.)" value={formatUSD(moderate.contributorPool)} />
      </div>

      {!validation.valid && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1">
          <div className="font-medium text-destructive">Fix before export:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {validation.errors.map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
        </div>
      )}

      <Button onClick={generate} disabled={busy || !validation.valid}>
        {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
        Export draft PDF
      </Button>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-card/60 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
