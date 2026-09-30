// Reader system shared types — replaces donor's local-db.ts dependency.
// Phase A: stub shapes; Phase B will map these to live Supabase rows.

export type DocStatus = "Draft" | "Review" | "Approved" | "Locked" | "Deprecated";
export type AssetStatus = "Draft" | "Review" | "Approved" | "Restricted" | "Deprecated";
export type Confidentiality = "Public" | "Internal" | "Confidential";

export interface QiSecScores {
  truthScore: number;
  authorityLevel: number;
  changeRisk: number;
  accessScore: number;
}

export interface UsageRights {
  license: string;
  territory: string;
  expires_at: string;
}

export interface ReaderDoc {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: DocStatus;
  version: number;
  is_canonical?: boolean;
  confidentiality: Confidentiality;
  tags?: string[];
  mime_type?: string;
  linked_asset_ids?: string[];
  updated_at?: string;
}

export interface ReaderAsset {
  id: string;
  title: string;
  description?: string;
  type: "Image" | "Video" | "Audio" | "Design";
  status: AssetStatus;
  thumbnail_url?: string;
  parent_asset_id?: string | null;
  linked_document_ids?: string[];
  usage_rights?: UsageRights;
  tags?: string[];
  updated_at?: string;
}

export function computeDocQiSec(d: ReaderDoc): QiSecScores {
  const truth = (d.is_canonical ? 0.5 : 0) +
    (d.status === "Locked" ? 0.5 : d.status === "Approved" ? 0.35 : d.status === "Review" ? 0.2 : 0.05);
  const auth = d.status === "Locked" ? 1 : d.status === "Approved" ? 0.75 : d.status === "Review" ? 0.5 : 0.25;
  const risk = d.status === "Deprecated" ? 0.9 : (d.linked_asset_ids?.length || 0) > 3 ? 0.6 : 0.3;
  const access = d.confidentiality === "Confidential" ? 0.9 : d.confidentiality === "Internal" ? 0.55 : 0.25;
  return { truthScore: Math.min(1, truth), authorityLevel: auth, changeRisk: risk, accessScore: access };
}

export function computeAssetQiSec(a: ReaderAsset): QiSecScores {
  const truth = a.status === "Approved" ? 0.85 : a.status === "Review" ? 0.5 : 0.3;
  const auth = a.status === "Approved" ? 0.85 : a.status === "Restricted" ? 0.6 : 0.4;
  const expired = !!a.usage_rights && new Date(a.usage_rights.expires_at) < new Date();
  const risk = expired ? 0.95 : a.parent_asset_id ? 0.5 : 0.25;
  const access = a.status === "Restricted" ? 0.85 : 0.3;
  return { truthScore: truth, authorityLevel: auth, changeRisk: risk, accessScore: access };
}

// Phase-A stub catalog so reader pages render without backend wiring.
export const DEMO_DOCS: ReaderDoc[] = [
  { id: "d1", title: "Final Shooting Script", category: "Screenplay", status: "Locked", version: 7,
    is_canonical: true, confidentiality: "Confidential", tags: ["script", "v7"],
    description: "The locked production draft, source of truth for all departments.",
    linked_asset_ids: ["a1", "a2"] },
  { id: "d2", title: "Director's Treatment", category: "Treatment", status: "Approved", version: 3,
    confidentiality: "Internal", tags: ["treatment"],
    description: "Tone, themes, visual references — companion to the script.",
    linked_asset_ids: ["a3"] },
  { id: "d3", title: "Pitch Deck — Investors", category: "Pitch", status: "Review", version: 2,
    confidentiality: "Confidential", tags: ["pitch"],
    description: "Funding deck currently under partner review.",
    linked_asset_ids: ["a1"] },
  { id: "d4", title: "Casting Brief", category: "Production", status: "Draft", version: 1,
    confidentiality: "Internal", tags: ["casting"],
    description: "Role breakdown and audition guidance." },
];

export const DEMO_ASSETS: ReaderAsset[] = [
  { id: "a1", title: "Teaser Poster v3", type: "Image", status: "Approved", tags: ["poster"],
    description: "Primary teaser key art." },
  { id: "a2", title: "Sizzle Reel — Cut 4", type: "Video", status: "Review", tags: ["reel"],
    description: "Two-minute proof-of-concept reel." },
  { id: "a3", title: "Mood Board — Cinema Aurea", type: "Design", status: "Approved",
    description: "Color palette and reference frames." },
  { id: "a4", title: "Score Demo — Main Theme", type: "Audio", status: "Draft",
    description: "Composer rough pass." },
  { id: "a5", title: "Behind-the-Scenes Stills", type: "Image", status: "Restricted", parent_asset_id: "a1",
    usage_rights: { license: "Editorial only", territory: "WW", expires_at: "2025-01-01" } },
];
