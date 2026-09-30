export type Jurisdiction = "US" | "UK" | "EU" | "CA" | "AU" | "IN" | "ZA" | "NZ" | "OTHER";

export interface JurisdictionProfile {
  code: Jurisdiction;
  label: string;
  currencyCode: string;       // ISO-4217 for display hint (storage stays USD)
  currencyLabel: string;
  governingLaw: string;
  residualsBody: string;      // collecting society / union for residuals language
  withholdingNote: string;    // tax note for the PDF
  collectionAccountNote: string;
  reservedRightsCaveat: string;
  rightsTermOverrides?: Partial<Record<
    "theatrical" | "svod" | "avod" | "tv" | "foreign" | "merch" | "publishing" | "podcast" | "games_interactive" | "live_events" | "nfts_collectibles" | "derivative_productions",
    string
  >>;
}

export const JURISDICTIONS: JurisdictionProfile[] = [
  {
    code: "US",
    label: "United States",
    currencyCode: "USD",
    currencyLabel: "US Dollars",
    governingLaw: "The laws of the State of California, USA (without regard to its conflict-of-laws principles).",
    residualsBody: "SAG-AFTRA, DGA and WGA residuals (where applicable)",
    withholdingNote: "US federal and state withholding taxes apply where required; non-US payees should provide W-8BEN or W-8BEN-E.",
    collectionAccountNote: "CAMA administered by a US- or UK-based independent Collection Account Manager.",
    reservedRightsCaveat: "Subject to any guild/union jurisdiction over the reserved exploitations.",
  },
  {
    code: "UK",
    label: "United Kingdom",
    currencyCode: "GBP",
    currencyLabel: "Pounds Sterling",
    governingLaw: "The laws of England and Wales (exclusive jurisdiction of the English courts).",
    residualsBody: "Equity, BECTU and Writers' Guild of Great Britain use-fees and royalties (where applicable)",
    withholdingNote: "UK income tax / NICs treatment and HMRC Film Tax Relief considerations; VAT applied to invoiced services where applicable.",
    collectionAccountNote: "CAMA typically administered by Fintage House, Freeway, NSquared or similar.",
    reservedRightsCaveat: "Reserved rights are subject to the Copyright, Designs and Patents Act 1988 moral-rights regime where not waived.",
    rightsTermOverrides: { tv: "Broadcast / Free-to-Air & Pay TV", merch: "Merchandising & Brand Licensing" },
  },
  {
    code: "EU",
    label: "European Union",
    currencyCode: "EUR",
    currencyLabel: "Euro",
    governingLaw: "The laws of the producer's principal place of business within the EU, with EU consumer-protection and copyright directives (incl. 2019/790 DSM) prevailing where mandatory.",
    residualsBody: "Local collecting societies (e.g. SACD, VG Wort, SIAE) and applicable equitable-remuneration claims under the DSM Directive",
    withholdingNote: "VAT and local withholding rules apply; cross-border B2B reverse charge typically applies under Art. 196 of the VAT Directive.",
    collectionAccountNote: "CAMA administered in line with EU AML/KYC obligations.",
    reservedRightsCaveat: "Authors retain inalienable moral rights and the unwaivable right to fair and proportionate remuneration under Art. 18 DSM Directive.",
  },
  {
    code: "CA",
    label: "Canada",
    currencyCode: "CAD",
    currencyLabel: "Canadian Dollars",
    governingLaw: "The laws of the Province of Ontario and the federal laws of Canada applicable therein.",
    residualsBody: "ACTRA, DGC and WGC residuals and use-fees (where applicable)",
    withholdingNote: "CRA Regulation 105 withholding and HST/GST/QST as applicable; Section 116 clearance for non-resident producers if relevant.",
    collectionAccountNote: "CAMA aligned with CAVCO / provincial tax-credit certification requirements.",
    reservedRightsCaveat: "Subject to Copyright Act (Canada) and any private-copying / equitable-remuneration claims.",
  },
  {
    code: "AU",
    label: "Australia",
    currencyCode: "AUD",
    currencyLabel: "Australian Dollars",
    governingLaw: "The laws of New South Wales, Australia.",
    residualsBody: "MEAA, ADG and AWG use-fees (where applicable)",
    withholdingNote: "PAYG withholding and GST apply where registered; Producer Offset (Div 376 ITAA 1997) considerations preserved.",
    collectionAccountNote: "CAMA aligned with Screen Australia and PISA-compliant reporting where applicable.",
    reservedRightsCaveat: "Subject to moral rights under Part IX of the Copyright Act 1968 (Cth) where not consented away.",
  },
  {
    code: "IN",
    label: "India",
    currencyCode: "INR",
    currencyLabel: "Indian Rupees",
    governingLaw: "The laws of India, with exclusive jurisdiction of the courts of Mumbai, Maharashtra.",
    residualsBody: "Statutory royalties under Sections 18 & 19 of the Indian Copyright Act, 1957 (unwaivable for authors of literary/musical works in cinematograph films)",
    withholdingNote: "TDS under Sections 194J/194C and GST as applicable; FEMA compliance for any foreign remittance.",
    collectionAccountNote: "CAMA aligned with RBI reporting if cross-border receipts are involved.",
    reservedRightsCaveat: "Author's statutory royalty share is unwaivable under the 2012 amendments to the Copyright Act.",
    rightsTermOverrides: { theatrical: "Theatrical (incl. satellite-driven release windows)" },
  },
  {
    code: "ZA",
    label: "South Africa",
    currencyCode: "ZAR",
    currencyLabel: "South African Rand",
    governingLaw: "The laws of the Republic of South Africa.",
    residualsBody: "SAGA / WGSA use-fees and DALRO / SAMRO collections (where applicable)",
    withholdingNote: "PAYE and VAT (15%) as applicable; Section 35A withholding for non-resident sellers if relevant.",
    collectionAccountNote: "CAMA aligned with DTIC film-rebate audit requirements where applicable.",
    reservedRightsCaveat: "Subject to the Copyright Act 98 of 1978 (as amended) and pending Copyright Amendment Bill provisions.",
  },
  {
    code: "NZ",
    label: "New Zealand",
    currencyCode: "NZD",
    currencyLabel: "New Zealand Dollars",
    governingLaw: "The laws of New Zealand.",
    residualsBody: "Equity NZ and NZWG use-fees (where applicable)",
    withholdingNote: "PAYE / schedular payment withholding and GST (15%) as applicable; NZSPG / NZSPR rebate considerations preserved.",
    collectionAccountNote: "CAMA aligned with NZ Film Commission reporting where applicable.",
    reservedRightsCaveat: "Subject to the Copyright Act 1994 (NZ).",
  },
  {
    code: "OTHER",
    label: "Other / Custom",
    currencyCode: "USD",
    currencyLabel: "US Dollars (default)",
    governingLaw: "To be specified in the long-form agreement; parties should negotiate governing law and forum.",
    residualsBody: "Applicable local guild / union / collecting-society residuals",
    withholdingNote: "Apply local withholding, VAT/GST and treaty rules.",
    collectionAccountNote: "Use a reputable independent Collection Account Manager.",
    reservedRightsCaveat: "Subject to applicable local moral-rights and statutory-royalty regimes.",
  },
];

export const JURISDICTION_MAP: Record<Jurisdiction, JurisdictionProfile> =
  JURISDICTIONS.reduce((acc, p) => ({ ...acc, [p.code]: p }), {} as Record<Jurisdiction, JurisdictionProfile>);

export function getJurisdiction(code: string | null | undefined): JurisdictionProfile {
  return JURISDICTION_MAP[(code as Jurisdiction) ?? "US"] ?? JURISDICTION_MAP.US;
}

/**
 * Custom-clause fields a deal must populate when jurisdiction === "OTHER".
 * Used by both the validator and the dedicated editor checklist section.
 */
export const OTHER_REQUIRED_FIELDS = [
  { key: "custom_governing_law",            label: "Governing law",                  domId: "other-governing-law" },
  { key: "custom_forum",                    label: "Forum / exclusive jurisdiction", domId: "other-forum" },
  { key: "custom_residuals_body",           label: "Residuals body / collecting society", domId: "other-residuals-body" },
  { key: "custom_withholding_note",         label: "Withholding-tax note",           domId: "other-withholding" },
  { key: "custom_collection_account_note",  label: "Collection-account (CAMA) note", domId: "other-cama" },
  { key: "custom_reserved_rights_caveat",   label: "Reserved-rights caveat",         domId: "other-reserved-caveat" },
] as const;

export type OtherCustomKey = (typeof OTHER_REQUIRED_FIELDS)[number]["key"];

/**
 * Merges a deal's custom clauses into the resolved jurisdiction profile when
 * `OTHER` is selected, so downstream consumers (PDF, reserved-rights grid) just
 * read profile fields without branching.
 */
export function resolveDealJurisdiction(deal: {
  jurisdiction: string;
  custom_governing_law?: string | null;
  custom_forum?: string | null;
  custom_residuals_body?: string | null;
  custom_withholding_note?: string | null;
  custom_collection_account_note?: string | null;
  custom_reserved_rights_caveat?: string | null;
}): JurisdictionProfile {
  const base = getJurisdiction(deal.jurisdiction);
  if (deal.jurisdiction !== "OTHER") return base;
  const law = (deal.custom_governing_law ?? "").trim();
  const forum = (deal.custom_forum ?? "").trim();
  const governingLaw = [law, forum && `Exclusive jurisdiction: ${forum}.`].filter(Boolean).join(" ") || base.governingLaw;
  return {
    ...base,
    governingLaw,
    residualsBody: (deal.custom_residuals_body ?? "").trim() || base.residualsBody,
    withholdingNote: (deal.custom_withholding_note ?? "").trim() || base.withholdingNote,
    collectionAccountNote: (deal.custom_collection_account_note ?? "").trim() || base.collectionAccountNote,
    reservedRightsCaveat: (deal.custom_reserved_rights_caveat ?? "").trim() || base.reservedRightsCaveat,
  };
}
