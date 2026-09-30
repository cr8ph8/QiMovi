import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildDocxZip(docXml: string, title: string) {
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  return { docXml, relsXml, wordRelsXml, contentTypesXml };
}

function wrapDocXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14">
  <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;
}

function markdownToDocxBody(content: string): string {
  const lines = content.split("\n");
  let bodyXml = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`;
    } else if (trimmed.startsWith("## ")) {
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(trimmed.slice(3))}</w:t></w:r></w:p>`;
    } else if (trimmed.startsWith("### ")) {
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${escapeXml(trimmed.slice(4))}</w:t></w:r></w:p>`;
    } else if (trimmed.startsWith("- ")) {
      bodyXml += `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">• ${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`;
    } else if (trimmed === "---") {
      bodyXml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
    } else if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").filter(Boolean).map(c => c.trim());
      bodyXml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(cells.join("  |  "))}</w:t></w:r></w:p>`;
    } else if (trimmed === "") {
      bodyXml += `<w:p/>`;
    } else {
      bodyXml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r></w:p>`;
    }
  }
  return bodyXml;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (v: number) => v === 0 ? "$0" : `$${v < 0 ? "-" : ""}${Math.abs(v).toLocaleString()}`;
const sumArrays = (...arrs: number[][]): number[] => arrs[0].map((_, i) => arrs.reduce((s, a) => s + (a[i] || 0), 0));
const sumArr = (a: number[]) => a.reduce((s, v) => s + v, 0);

function buildProFormaDocxBody(pf: any): string {
  const colW = 950; // each month col
  const labelW = 2600;
  const totalW = 1100;
  const border = `<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;

  function cell(text: string, bold = false, shading = "", align = "left"): string {
    const shade = shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : "";
    const bTag = bold ? "<w:b/>" : "";
    const jc = align === "right" ? `<w:jc w:val="right"/>` : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/><w:tcBorders>${border}</w:tcBorders>${shade}<w:tcMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr>${jc}<w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  }

  function labelCell(text: string, bold = false, shading = ""): string {
    const shade = shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : "";
    const bTag = bold ? "<w:b/>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${labelW}" w:type="dxa"/><w:tcBorders>${border}</w:tcBorders>${shade}<w:tcMar><w:left w:w="60" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  }

  function totalCell(text: string, bold = false, shading = ""): string {
    const shade = shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : "";
    const bTag = bold ? "<w:b/>" : "";
    return `<w:tc><w:tcPr><w:tcW w:w="${totalW}" w:type="dxa"/><w:tcBorders>${border}</w:tcBorders>${shade}<w:tcMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:jc w:val="right"/><w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr><w:r><w:rPr>${bTag}<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  }

  function dataRow(label: string, vals: number[], bold = false, shade = ""): string {
    const total = sumArr(vals);
    return `<w:tr>${labelCell(label, bold, shade)}${vals.map(v => cell(fmt(v), bold, shade, "right")).join("")}${totalCell(fmt(total), bold, shade)}</w:tr>`;
  }

  function headerRow(label: string): string {
    const shade = "D9E2F3";
    const cols = Array(13).fill("").map(() => cell("", true, shade)).join("");
    return `<w:tr>${labelCell(label, true, shade)}${cols.slice(0, 12)}${totalCell("", true, shade)}</w:tr>`;
  }

  // Computed
  const r = pf.revenue || {};
  const c = pf.cogs || {};
  const s = pf.selling || {};
  const g = pf.ga || {};
  const w = pf.wages || {};
  const o = pf.operations || {};
  const z = () => Array(12).fill(0);
  
  const totalRev = sumArrays(r.token || z(), r.subscription || z(), r.ad || z());
  const totalCOGS = sumArrays(c.hosting || z(), c.licenses || z(), c.merchant_fees || z());
  const grossProfit = totalRev.map((rv: number, i: number) => rv - totalCOGS[i]);
  const totalSelling = sumArrays(...Object.values(s).map((v: any) => v || z()));
  const totalGA = sumArrays(...Object.values(g).map((v: any) => v || z()));
  const totalWages = sumArrays(...Object.values(w).map((v: any) => v || z()));
  const totalOps = sumArrays(...Object.values(o).map((v: any) => v || z()));
  const totalExp = sumArrays(totalSelling, totalGA, totalWages, totalOps);
  const netOrd = grossProfit.map((gp: number, i: number) => gp - totalExp[i]);
  const oi = pf.other_income || {};
  const oe = pf.other_expenses || {};
  const netIncome = netOrd.map((n: number, i: number) => n + (oi.interest?.[i] || 0) - (oe.bank_fees?.[i] || 0));
  const cf = pf.cashflow || {};
  const netCash = sumArrays(cf.carryover || z(), cf.investment || z(), cf.operations_cf || z());
  const comp = pf.compensation || {};
  const totalPayroll = comp.payroll ? sumArrays(...Object.values(comp.payroll).map((v: any) => v || z())) : z();
  const totalBenefits = comp.benefits ? sumArrays(...Object.values(comp.benefits).map((v: any) => v || z())) : z();

  // Header row
  const hdrCells = MONTHS.map(m => cell(m, true, "4472C4", "right").replace(/<w:sz w:val="16"\/>/g, '<w:sz w:val="16"/><w:color w:val="FFFFFF"/>')).join("");
  const tableHeader = `<w:tr>${labelCell("SaaS Pro-Forma — FY " + (pf.year || new Date().getFullYear()), true, "4472C4").replace(/<w:sz w:val="16"\/>/g, '<w:sz w:val="16"/><w:color w:val="FFFFFF"/>')}${hdrCells}${totalCell("TOTAL", true, "4472C4").replace(/<w:sz w:val="16"\/>/g, '<w:sz w:val="16"/><w:color w:val="FFFFFF"/>')}`;

  const gridCols = `<w:tblGrid><w:gridCol w:w="${labelW}"/>${MONTHS.map(() => `<w:gridCol w:w="${colW}"/>`).join("")}<w:gridCol w:w="${totalW}"/></w:tblGrid>`;

  let rows = tableHeader;
  rows += headerRow("REVENUE");
  rows += dataRow("Token Revenue", r.token || z());
  rows += dataRow("Subscription Revenue", r.subscription || z());
  rows += dataRow("Ad Revenue", r.ad || z());
  rows += dataRow("Total Revenue", totalRev, true, "E2EFDA");

  rows += headerRow("COST OF GOODS SOLD");
  rows += dataRow("Hosting / AI Infra", c.hosting || z());
  rows += dataRow("Licenses", c.licenses || z());
  rows += dataRow("Merchant Fees", c.merchant_fees || z());
  rows += dataRow("Total COGS", totalCOGS, true, "E2EFDA");
  rows += dataRow("GROSS PROFIT", grossProfit, true, "D6E4F0");

  rows += headerRow("SELLING EXPENSES");
  for (const [k, label] of [["ad_spend","Ad Spend"],["design","Design"],["development","Development"],["marketing","Marketing"],["travel","Travel"],["meals","Meals & Entertainment"],["equipment","Equipment"],["website_email","Website / Email"]]) {
    rows += dataRow(label, s[k] || z());
  }
  rows += dataRow("Total Selling", totalSelling, true, "E2EFDA");

  rows += headerRow("G&A EXPENSES");
  for (const [k, label] of [["office","Office Supplies"],["legal","Legal & Accounting"],["rent","Rent"],["utilities","Utilities"],["insurance","Insurance"],["subscriptions","Subscriptions / SaaS"],["telephone","Telephone"]]) {
    rows += dataRow(label, g[k] || z());
  }
  rows += dataRow("Total G&A", totalGA, true, "E2EFDA");

  rows += headerRow("WAGES & BENEFITS");
  for (const [k, label] of [["four01k","401(k) Match"],["bonus","Bonus"],["contractor","Contractor"],["payroll_taxes","Payroll Taxes"],["unemployment","Unemployment Tax"]]) {
    rows += dataRow(label, w[k] || z());
  }
  rows += dataRow("Total Wages", totalWages, true, "E2EFDA");

  rows += headerRow("OPERATIONS");
  rows += dataRow("Equipment / Computers", o.equipment_computers || z());
  rows += dataRow("Repairs & Maintenance", o.repairs || z());
  rows += dataRow("Total Operations", totalOps, true, "E2EFDA");

  rows += dataRow("TOTAL EXPENSE", totalExp, true, "FFF2CC");
  rows += dataRow("NET ORDINARY INCOME", netOrd, true, "D6E4F0");

  rows += headerRow("OTHER INCOME/EXPENSES");
  rows += dataRow("Interest Income", oi.interest || z());
  rows += dataRow("Bank Fees", oe.bank_fees || z());
  rows += dataRow("NET INCOME", netIncome, true, "C6EFCE");

  rows += headerRow("CASH FLOW");
  rows += dataRow("Cash Carryover", cf.carryover || z());
  rows += dataRow("Investment / Funding", cf.investment || z());
  rows += dataRow("Operations Cash", cf.operations_cf || z());
  rows += dataRow("Net Cash Position", netCash, true, "C6EFCE");

  rows += headerRow("COMPENSATION — PAYROLL");
  if (comp.payroll) {
    for (const [k, label] of [["owner","Owner / Founder"],["emp1","Employee 1"],["emp2","Employee 2"],["emp3","Employee 3"],["emp4","Employee 4"]]) {
      rows += dataRow(label, comp.payroll[k] || z());
    }
  }
  rows += dataRow("Total Payroll", totalPayroll, true, "E2EFDA");

  rows += headerRow("COMPENSATION — BENEFITS");
  if (comp.benefits) {
    for (const [k, label] of [["owner","Owner / Founder"],["emp1","Employee 1"],["emp2","Employee 2"],["emp3","Employee 3"],["emp4","Employee 4"]]) {
      rows += dataRow(label, comp.benefits[k] || z());
    }
  }
  rows += dataRow("Total Benefits", totalBenefits, true, "E2EFDA");

  const tblW = labelW + colW * 12 + totalW;
  return `<w:tbl><w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>${gridCols}${rows}</w:tbl>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roleData } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleData) throw new Error("Admin access required");

    const { document_id, format } = await req.json();
    if (!document_id || !format) throw new Error("Missing document_id or format");

    const { data: doc, error: docErr } = await supabase.from("business_documents").select("*").eq("id", document_id).single();
    if (docErr || !doc) throw new Error("Document not found");

    // Governance audit (fire-and-forget — must not block export)
    try {
      await logGovernanceAction({
        userId: user.id,
        action: "document.export",
        details: { document_id, format, title: doc.title },
      });
    } catch (e) { console.error("[export-document] audit_log failed (non-fatal):", e); }

    const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");

    if (format === "proforma-docx") {
      const pf = JSON.parse(doc.content as string);
      const title = doc.title as string;
      const bodyXml = buildProFormaDocxBody(pf);
      const docXml = wrapDocXml(bodyXml);
      const parts = buildDocxZip(docXml, title);

      const zip = new JSZip();
      zip.file("[Content_Types].xml", parts.contentTypesXml);
      zip.file("_rels/.rels", parts.relsXml);
      zip.file("word/document.xml", parts.docXml);
      zip.file("word/_rels/document.xml.rels", parts.wordRelsXml);

      const buffer = await zip.generateAsync({ type: "uint8array" });
      const base64 = btoa(String.fromCharCode(...buffer));

      return new Response(JSON.stringify({ base64, filename: `${title}.docx` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (format === "docx") {
      const content = doc.content as string;
      const title = doc.title as string;
      const bodyXml = markdownToDocxBody(content);
      const docXml = wrapDocXml(bodyXml).replace('w:orient="landscape"', '').replace('w:w="15840" w:h="12240"', 'w:w="12240" w:h="15840"').replace('w:top="720"', 'w:top="1440"').replace('w:right="720"', 'w:right="1440"').replace('w:bottom="720"', 'w:bottom="1440"').replace('w:left="720"', 'w:left="1440"');
      const parts = buildDocxZip(docXml, title);

      const zip = new JSZip();
      zip.file("[Content_Types].xml", parts.contentTypesXml);
      zip.file("_rels/.rels", parts.relsXml);
      zip.file("word/document.xml", parts.docXml);
      zip.file("word/_rels/document.xml.rels", parts.wordRelsXml);

      const buffer = await zip.generateAsync({ type: "uint8array" });
      const base64 = btoa(String.fromCharCode(...buffer));

      return new Response(JSON.stringify({ base64, filename: `${title}.docx` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (format === "pptx") {
      const content = doc.content as string;
      const title = doc.title as string;
      const slides = content.split(/\n---\n/).map(s => s.trim()).filter(Boolean);

      const zip = new JSZip();
      const contentTypesEntries = slides.map((_, i) => 
        `<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
      ).join("");

      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${contentTypesEntries}
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>`);

      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

      const slideRels = slides.map((_, i) => 
        `<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`
      ).join("");

      zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`);

      const slideIdList = slides.map((_, i) => `<p:sldId id="${256+i}" r:id="rId${i+2}"/>`).join("");
      zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIdList}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
</p:presentation>`);

      zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);

      zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`);

      zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

      zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`);

      slides.forEach((slideContent, i) => {
        const lines = slideContent.split("\n").filter(l => l.trim());
        let slideTitle = "";
        const bodyLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("## ")) slideTitle = trimmed.slice(3);
          else if (trimmed.startsWith("# ")) slideTitle = trimmed.slice(2);
          else if (trimmed.startsWith("- ")) bodyLines.push("• " + trimmed.slice(2));
          else if (trimmed.length > 0) bodyLines.push(trimmed);
        }

        const bodyParas = bodyLines.map(l => `<a:p><a:r><a:rPr lang="en-US" sz="1800" dirty="0"/><a:t>${escapeXml(l)}</a:t></a:r></a:p>`).join("");

        zip.file(`ppt/slides/slide${i+1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1" dirty="0"/><a:t>${escapeXml(slideTitle || `Slide ${i+1}`)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bodyParas || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

        zip.file(`ppt/slides/_rels/slide${i+1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);
      });

      const buffer = await zip.generateAsync({ type: "uint8array" });
      const base64 = btoa(String.fromCharCode(...buffer));

      return new Response(JSON.stringify({ base64, filename: `${title}.pptx` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unsupported format: ${format}`);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
