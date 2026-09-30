export interface TokenRecordRef { id: string; version: number; sha256: string }
export interface TokenPublicFields { name: string; description: string; imageUri: string; licenceUri: string; licenceSummary: string }
export interface TokenPreparationRequest { projectId: string; requestId: string; passportRef: TokenRecordRef; participationRef: TokenRecordRef; publicFields: TokenPublicFields }
export interface TokenHistory { id: string; kind: string; entries: { version: number; sha256: string }[]; chainHash: string }
export interface TokenPreparation {
  schemaVersion: 1; projectId: string; sourceHash: string | null; status: 'PREPARED_LOCALLY'; requestId: string; preparedAt: string;
  assetHash: string; passportRef: TokenRecordRef; participationRef: TokenRecordRef;
  edition: { standard: 'UNDECIDED' | 'ERC721' | 'ERC1155'; seriesId: string; cap: number | null; royaltyBps: number | null };
  publicFields: TokenPublicFields;
  privateProof: { nonce: string; histories: TokenHistory[]; commitment: string };
  publicMetadata: { name: string; description: string; image?: string; properties: { qimovi: { format: 'qimovi-nft-metadata/v1'; standard: string; editionCap: number | null; royaltyRequestBps: number | null; licenceSummary: string; licenceUri: string; commitment: string } } };
  metadataSha256: string; warnings: string[];
}
export const TOKEN_PREPARATION_KIND: 'asset-token-preparation';
export function validateTokenPreparationRequest(value: unknown): TokenPreparationRequest;
export function validateTokenPreparation(value: unknown, project?: { id: string; sourceHash: string | null }): TokenPreparation;
export function validateTokenPreparationIdentity(id: string, kind: string, value: unknown, version?: number): void;
export function tokenPublicMetadata(value: Pick<TokenPreparation, 'publicFields' | 'edition' | 'privateProof'>): TokenPreparation['publicMetadata'];
