import { retainedRecordMatchesProject } from './projectLibraryModel';
import { defaultMarketDetails, parseMarketDetails, validateAssetMarketProfile } from '../../local/contracts/asset-market-profile.mjs';
import { evaluateAssetOptionScenario } from '../../local/contracts/asset-valuation.mjs';
import { canonicalJson } from './canonical';
import type { AssetMarketProfile, WorkspaceRecord } from './types';

export type MarketAsset = { sha256: string; title: string; mimeType: string; filename?: string };
export type MarketProject = { id: string; title: string; sourceHash: string | null };
export function marketAssetsFromRecords(records: WorkspaceRecord[], project: MarketProject): MarketAsset[] {
  const result: MarketAsset[] = [];
  for (const record of records) {
    const d = record.data as { sourceHash?: string | null; projectId?: string; title?: string; originalFilename?: string; asset?: { sha256: string; mimeType: string }; original?: { sha256: string; mimeType: string }; assetHash?: string; mimeType?: string; files?: {sha256: string; filename: string; mimeType: string}[] };
    if (!retainedRecordMatchesProject(record, project)) continue;
    if (record.kind === 'project-asset' && d.asset) result.push({ ...d.asset, title: d.title ?? d.originalFilename ?? record.id });
    if (record.kind === 'studio-media' && d.assetHash && d.mimeType) result.push({ sha256: d.assetHash, mimeType: d.mimeType, title: d.originalFilename ?? record.id });
    if (record.kind === 'lore-source' && d.original) result.push({ ...d.original, title: d.title ?? record.id });
    if (record.kind === 'comic-package') for (const file of d.files ?? []) result.push({ ...file, title: file.filename });
  }
  return [...new Map(result.map(asset => [asset.sha256, asset])).values()];
}
export type OptionInputs = { optionType?: string; underlyingDescription?: string; currency?: string; underlyingReferenceValue?: number | null; strikePrice?: number | null; timeToExpiryYears?: number | null; annualRiskFreeRate?: number | null; annualVolatility?: number | null; annualYield?: number | null };
export type MarketDetails = {
  issuer: string; creator: string; copyrightHolder: string; description: string; credits: string;
  rightsScope: string; territory: string; term: string; transferable: boolean | null; derivativesAllowed: boolean | null;
  licenceEvidenceHashes: string[]; parentAssetHashes: string[];
  edition: { seriesId: string; cap: number | null; tokenStandard: 'UNDECIDED' | 'ERC721' | 'ERC1155'; royaltyBps: number | null };
  pricing: { currency: string; askingMinor: number | null; creationCostMinor: number | null; optionScenario: OptionInputs | null };
};
export function marketDetails(data?: AssetMarketProfile, editable = false): MarketDetails {
  const base = defaultMarketDetails() as MarketDetails, saved = data ? (editable ? JSON.parse(data.detailsJson) : parseMarketDetails(data)) as Partial<MarketDetails> : {};
  return { ...base, ...saved, edition: { ...base.edition, ...saved.edition }, pricing: { ...base.pricing, ...saved.pricing } };
}
export function newMarketProfile(project: MarketProject, asset: MarketAsset, parents: string[] = []): AssetMarketProfile {
  const details = marketDetails(); details.parentAssetHashes = [...new Set(parents)].filter(hash => hash !== asset.sha256);
  return { schemaVersion: 1, projectId: project.id, sourceHash: project.sourceHash, assetHash: asset.sha256, mimeType: asset.mimeType, title: asset.title.slice(0, 240), detailsJson: JSON.stringify(details), status: 'DRAFT' };
}
export function marketChecklist(profile: AssetMarketProfile, editable = false) {
  const d = marketDetails(profile, editable);
  return [
    { id: 'identity', label: 'Asset title and description', complete: Boolean(profile.title.trim() && d.description.trim()) },
    { id: 'parties', label: 'Issuer, creator and copyright holder declared', complete: [d.issuer, d.creator, d.copyrightHolder].every(x => x.trim()) },
    { id: 'licence', label: 'Licence scope, territory and term drafted', complete: [d.rightsScope, d.territory, d.term].every(x => x.trim()) },
    { id: 'permission', label: 'Transfer and derivative permissions declared', complete: d.transferable !== null && d.derivativesAllowed !== null },
    { id: 'evidence', label: 'Supporting licence documents attached', complete: d.licenceEvidenceHashes.length > 0 },
    { id: 'edition', label: 'Edition identity, cap and token standard proposed', complete: Boolean(d.edition.seriesId.trim() && d.edition.cap && d.edition.tokenStandard !== 'UNDECIDED') },
    { id: 'price', label: 'Asking price and currency declared', complete: Boolean(d.pricing.currency.trim() && d.pricing.askingMinor !== null) },
  ];
}
export function marketValidation(profile: AssetMarketProfile, project: MarketProject): string | null {
  try { validateAssetMarketProfile(profile, project); return null; } catch (e) { return e instanceof Error ? e.message.replace(/_/g, ' ').toLowerCase() : 'Invalid draft'; }
}
export async function marketBytesHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), x => x.toString(16).padStart(2, '0')).join('');
}
export async function assetMarketPassport(profile: AssetMarketProfile, project: MarketProject, saved?: WorkspaceRecord) {
  validateAssetMarketProfile(profile, project);
  const details = marketDetails(profile), checklist = marketChecklist(profile);
  const canonicalBytes = new TextEncoder().encode(canonicalJson(profile)), profileHash = await marketBytesHash(canonicalBytes);
  const exactSaved = saved?.kind === 'asset-market-profile' && saved.id === `asset-market:${profile.assetHash}` && canonicalJson(saved.data) === canonicalJson(profile) && saved.sha256 === profileHash;
  const blockers = [
    ...checklist.filter(row => !row.complete).map(row => row.label),
    ...(details.transferable === false ? ['Declared licence prohibits transfer; do not offer a transferable asset.'] : []),
    'Rights and authority to offer this exact asset need independent review.',
    ...(details.parentAssetHashes.length ? ['Derivative sources and their licence obligations need review.'] : []),
    'Edition allocation, contract, custody, marketplace and settlement are not connected.',
  ];
  return {
    schema: 'caniscreenwrite-asset-market-passport/v1', status: 'DRAFT_FOR_REVIEW', projectId: project.id, sourceHash: profile.sourceHash,
    asset: { sha256: profile.assetHash, mimeType: profile.mimeType, title: profile.title },
    profileSha256: profileHash, profile, savedRecord: exactSaved ? { id: saved.id, version: saved.version, sha256: saved.sha256 } : null,
    checklist, blockers, marketReady: false, issuancePerformed: false, issuanceStatus: 'NOT_CONNECTED', verifiedLiveSupply: null,
    priceStatus: details.pricing.askingMinor === null ? 'UNPRICED' : 'OWNER_DECLARED_ASK',
    optionScenario: evaluateAssetOptionScenario(details.pricing.optionScenario),
    proposedMetadata: { name: profile.title, description: details.description, properties: { originalSha256: profile.assetHash, creator: details.creator, issuer: details.issuer, copyrightHolder: details.copyrightHolder, edition: details.edition, parentAssetHashes: details.parentAssetHashes, licenceEvidenceHashes: details.licenceEvidenceHashes } },
    notes: ['No chain, token, sale, licence grant or copyright transfer is created by this package.', 'Edition caps and royalties are proposals. They are not enforced by a blockchain or marketplace.', 'Asking price, cost and hypothetical option premium are separate values.'],
  };
}
