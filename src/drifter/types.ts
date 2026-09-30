export type CellRole = 'START' | 'MOMENT' | 'END';
export type SegmentMethod = 'SUPPLIED' | 'FILMED' | 'AI' | 'HYBRID';
export interface Scene {
  id: string; index: number; heading: string;
  shots: { id: string; label: string; description: string; plannedDurationMs: number | null }[];
  paragraphs: { id: string; type: string; text: string }[];
}
export interface CameraOriginRef { id: string; sha256: string; frameId: string }
export interface DccReturnOriginRef { receiptSha256: string; kitFilesSha256: string; frameId: string }
export interface CameraObservation { sourceHash: string; sceneId: string; exchangeHash: string; basisHash: string; proofHash: string; handoffRef?: AuthoringInputRef; artifacts: {name:string;sha256:string;bytes:number}[]; frames:{id:string;shotId:string;cellId:string;role:CellRole;imageHash:string;width:number;height:number;frame:number;actionRefs:string[]}[]; scope:'INTERNAL_BLOCKING_PROOF';status:'CANDIDATE' }
export interface StoryCell {
  originCameraRef?: CameraOriginRef;
  originDccReturnRef?: DccReturnOriginRef;
  id: string; sceneId: string; shotId: string; role: CellRole; imageHash?: string | null;
  pixelWidth?: number; pixelHeight?: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
  review: 'PENDING' | 'MISSING'; description: string;
  actionRefs?: string[]; plannedTimestampMs?: number | null;
}
export interface Character {
  id: string; name: string; description: string; referenceImageHash?: string | null; useScope?: string;
}
export interface Project {
  creativeOrigin?: CreativeProject;
  productionAttachmentRef?: { id: string; version: number; sha256: string };
  productionDraftRef?: { id: string; version: number; sha256: string };
  productionPlanRef?: { id: string; version: number; sha256: string };
  id: string; title: string; sourceHash: string; sourceStatus: string;
  scenes: Scene[]; cells: StoryCell[]; characters: Character[];
  continuityQuestions: (string | { id?: string; question?: string; text?: string })[];
  prologue?: { id: string; type: string; text: string }[];
  cellBasisHashes?: Record<string, string>; cellRevisionSceneIds?: string[];
}
export interface CreativeProject {
  id: string; title: string; profile: 'caniscreenwrite-creative/v1';
  sourceHash: null; sourceStatus: 'NO_SCREENPLAY';
  scenes: []; cells: []; characters: []; continuityQuestions: [];
  cellBasisHashes?: Record<string, never>; cellRevisionSceneIds?: [];
}
export type WorkspaceProject = Project | CreativeProject;
export interface ScenePlan {
  sceneId: string; sourceHash: string; notes: string;
  cellBasisHash?: string;
  cellOverrides: { cellId: string; role: CellRole; note: string }[];
  timingObservations: { durationMs: number; note: string; recordedAt: string }[];
  segments: { id: string; durationMs: number; cellIds: string[]; method: SegmentMethod }[];
}
export interface CastingDraft {
  sourceHash: string; characterId: string; performer: string;
  referenceHashes: string[]; useScope: 'INTERNAL_STORYBOARD_REFERENCE_ONLY' | 'FILM_USE_REQUESTED';
  evidenceHashes: string[]; notes: string;
}
export interface StoryboardCellDraft {
  originCameraRef?: CameraOriginRef;
  originDccReturnRef?: DccReturnOriginRef;
  sourceHash: string; cellId: string; sceneId: string; shotId: string; role: CellRole;
  imageHash: string | null; crop: StoryCell['crop']; pixelWidth?: number; pixelHeight?: number;
  description: string; actionRefs: string[]; plannedTimestampMs: number | null; review: 'PENDING';
}
export interface DocumentDraft { sourceHash: string; typeId: string; dependencyHashes: string[]; body: string; status: 'DRAFT' }
export interface AuthoringInputRef { id: string; sha256: string }
export interface ProductionHandoff { sourceHash: string; sceneId: string; authoringRef: AuthoringInputRef; shotIds: string[]; purpose: 'PLANNING_CONTEXT'; notes: string }
export type AuthoringFormat = 'vertical' | 'micro' | 'short' | 'pilot_30' | 'pilot_60' | 'feature';
export interface ScreenplayDraft { sourceHash: string; title: string; format: 'FOUNTAIN'; body: string; sceneId?: string; genre?: string; projectFormat?: AuthoringFormat; targetPages?: number; inputRefs?: AuthoringInputRef[]; sceneMap?: import('../../local/contracts/writing-scene-map.mjs').WritingSceneMap }
export interface CreativeScreenplayDraft { schemaVersion: 2; projectId: string; sourceHash: null; title: string; format: 'FOUNTAIN'; body: string; status: 'DRAFT'; genre?: string; projectFormat?: AuthoringFormat; targetPages?: number; inputRefs?: AuthoringInputRef[]; sceneMap?: import('../../local/contracts/writing-scene-map.mjs').WritingSceneMap }
export type StudioGenerationPhase = 'PREPARING' | 'PREPARED' | 'PREPARATION_FAILED' | 'SUBMITTING' | 'SUBMISSION_UNKNOWN' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RETAINED';
export interface StudioGeneration { schemaVersion: 1; projectId: string; sourceHash: string | null; operationRef: { id: string; version: number; sha256: string }; provider: 'HIGGSFIELD_MCP'; phase: StudioGenerationPhase; createdAtMs: number; updatedAtMs: number; detailsJson: string }
export type StudioReferencePhase = 'PREPARING' | 'PREPARED' | 'CREATING' | 'CREATED' | 'CREATION_UNKNOWN' | 'PREPARATION_FAILED' | 'FAILED';
export interface StudioReference { schemaVersion: 1; projectId: string; sourceHash: string | null; operationRef: { id: string; version: number; sha256: string }; provider: 'HIGGSFIELD_MCP'; phase: StudioReferencePhase; createdAtMs: number; updatedAtMs: number; detailsJson: string }
export interface AssetMarketProfile { schemaVersion: 1; projectId: string; sourceHash: string | null; assetHash: string; mimeType: string; title: string; detailsJson: string; status: 'DRAFT' }
export type AssetMarketProfileRecord = WorkspaceRecord & { kind: 'asset-market-profile'; data: AssetMarketProfile };
export interface ComicPackage { schemaVersion: 1; projectId: string; sourceHash: string; title: string; status: 'PRIVATE_DRAFT'; manifestSha256: string; files: { role: 'PDF' | 'CBZ' | 'MANIFEST'; filename: string; mimeType: string; sha256: string; byteLength: number }[]; parentAssetHashes: string[]; panelCount: number; pageCount: number; recordRefs: { id: string; version: number; sha256: string }[]; verification: 'SOURCE_BINDINGS_AND_CONTAINERS_ONLY' }
export type ComicPackageRecord = WorkspaceRecord & { kind: 'comic-package'; data: ComicPackage };
/** Explicit visual anchors for planning; no interpolation or provider execution. */
export interface ShotKeyframePlan {
  schemaVersion: 1; projectId: string; sourceHash: string; sceneId: string; shotId: string;
  durationMs: number | null; frames: { cellId: string; atPermille: number; note: string }[];
  cellBindings: { cellId: string; signature: string }[]; notes: string; status: 'DRAFT';
}
export type ShotKeyframeRecord = WorkspaceRecord & { kind: 'shot-keyframes'; data: ShotKeyframePlan };
/** An editable layout; exported comic packages retain their separate immutable record. */
export interface ComicDraft {
  schemaVersion: 1 | 2; projectId: string; sourceHash: string; title: string; credits: string;
  panelsPerPage: 1 | 2 | 4; panels: { cellId: string; caption: string; paragraphIds: string[] }[]; status: 'DRAFT';
  pages?: import('../../local/contracts/comic-layouts.mjs').ComicPagePlan[];
}
export type ComicDraftRecord = WorkspaceRecord & { kind: 'comic-draft'; data: ComicDraft };
export interface ConceptDraft { sourceHash: string; title: string; type: string; tags: string[]; body: string; inputRefs?: AuthoringInputRef[] }
export interface StoryPlanDraft {
  sourceHash: string; title: string; logline: string; theme: string; genre: string; tone: string;
  actBeats: { id: string; act: string; beat: string; summary: string }[];
  characterArcs: { name: string; want: string; need: string; arc: string }[];
  sceneIndex: { id: string; index: number; slug: string; purpose: string; description?: string; characters?: string[]; beatId?: string; estimatedEighths?: number }[];
  openQuestions: string[]; inputRefs?: AuthoringInputRef[];
  tradition?: 'causal_western' | 'relational_eastern' | 'hybrid';
  structureModel?: 'three_act' | 'hero_journey' | 'kishotenketsu' | 'freytag' | 'harmon_circle' | 'hybrid';
}
/** Authored planning text; these notes do not grant production or rights authority. */
export interface ProjectPitchDetails {
  tagline?: string; format?: string; genre?: string; runtime?: string; creativeVision?: string;
  audience?: string; positioning?: string; team?: string; productionPlan?: string; budgetPlan?: string;
  financingPlan?: string; distributionPlan?: string; ask?: string; contact?: string; ipExpansion?: string;
  developmentStatus?: string; rightsStatus?: string;
}
/** Editable presentation copy, separate from the underlying project and source text. */
export interface ProjectPitchPresentationSlide {
  id: string; title: string; sections: { label: string; body: string }[];
  layout: 'text' | 'image-left' | 'background'; imageHash?: string; imageCaption?: string; hidden?: boolean;
}
export interface ProjectPitchPresentation {
  theme: 'cinema' | 'paper' | 'midnight'; accentColor: string; slides: ProjectPitchPresentationSlide[];
}
export interface PitchDraft {
  sourceHash: string; title: string; logline: string; synopsis: string; characterSummaries: string;
  thematicSummary: string; worldDescription: string; toneDescription: string; comparableReferences: string; inputRefs?: AuthoringInputRef[];
  projectDetails?: ProjectPitchDetails;
  presentation?: ProjectPitchPresentation;
}
/** Project-owned development content before a production screenplay is attached. */
export type CreativeAuthoringDraft = (Omit<ConceptDraft, 'sourceHash'> | Omit<StoryPlanDraft, 'sourceHash'> | Omit<PitchDraft, 'sourceHash'> | Omit<WritingNote, 'sourceHash'>) & { sourceHash: null; projectId: string };
export interface LoreRef { id:string; sha256:string; originalSha256:string; extractionSha256:string|null; pageNumber:number; textSha256:string|null }
export interface LorePage { pageNumber:number; text:string; textSha256:string; characters:number; textPath:string; pageWidthPoints:number; pageHeightPoints:number }
export interface LoreSource {
  sourceHash:string; title:string; originalFilename:string; documentType:'PDF'|'IMAGE';
  original:{sha256:string;bytes:number;mimeType:'application/pdf'|'image/png'|'image/jpeg'};
  extraction:null|{sha256:string;bytes:number;tool:string;version:string;mode:string;pageCount:number;ocrPerformed:boolean;pagesWithNoExtractedText:number[];pages:{pageNumber:number;textSha256:string;characters:number}[]};
  intakeManifest:{sha256:string;bytes:number};scope:'PROJECT_RESEARCH';review:'PENDING';
}
export interface LoreLibraryResponse { schema:'filmstack-lore-library/v1';projectId:string;sourceHash:string;records:WorkspaceRecord[] }
export interface ProjectAsset {
  schemaVersion: 1 | 2; sourceHash: string | null; projectId?: string; title: string; originalFilename: string;
  asset: { sha256: string; byteLength: number; mimeType: string };
  family: 'DOCUMENT' | 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'THREE_D' | 'ARCHIVE' | 'OPAQUE';
  category: string; collection: string; sourcePaths: string[]; collectionPath: string;
  scope: 'PROJECT_REFERENCE'; review: 'PENDING';
}
export type LorePages = LorePage[];
export interface WritingNote { sourceHash: string; title: string; body: string; category: 'CAPTURE' | 'RESEARCH' | 'REVISION'; tags: string[]; inputRefs?: AuthoringInputRef[]; loreRefs?:LoreRef[] }
export interface ContextBundle {
  schemaVersion: 1; sourceHash: string; sceneId: string; shotIds: string[]; title: string; status: 'DRAFT'; guidance: string;
  loreSelections: { ref: LoreRef; excerpt: string }[];
  noteSelections: { ref: AuthoringInputRef; excerpt: string }[];
  characterSelections: { ref: AuthoringInputRef; referenceHashes: string[] }[];
}
export interface ContextBundleCompiled {
  schemaVersion: 1; sourceHash: string; sceneId: string; sceneHash: string; shotIds: string[]; title: string; guidance: string;
  loreSelections: { ref: LoreRef; excerpt: string; record: WorkspaceRecord; pageText: string | null }[];
  noteSelections: { ref: AuthoringInputRef; excerpt: string; record: WorkspaceRecord }[];
  characterSelections: { ref: AuthoringInputRef; referenceHashes: string[]; record: WorkspaceRecord; characterName: string }[];
}
export interface ContextBundlePreview {
  schema: 'filmstack-context-preview/v1'; sourceHash: string; sceneId: string; bundleHash: string;
  compiled: ContextBundleCompiled; contextText: string; contextHash: string;
}
export interface ContextBundleCatalog {
  schema: 'filmstack-context-bundles/v1'; sourceHash: string; sceneId: string;
  bundles: { record: WorkspaceRecord; currentness: 'CURRENT' | 'STALE' | 'ABSENT'; reason: string }[];
}
export interface WritingSession { sourceHash: string; draftId: string; draftSha256: string; startedAt: string; endedAt: string; activeMs: number; wordsStart: number; wordsEnd: number; metricsOrigin: 'LOCAL_EDITOR_OBSERVATION' }
export type AuthoringDraft = ConceptDraft | StoryPlanDraft | PitchDraft | WritingNote | WritingSession;
export interface ReviewResolution { sourceHash: string; commentId: string; disposition: 'ACKNOWLEDGED' | 'ACTION_PLANNED' | 'DECLINED_WITH_REASON'; note: string; basisHash: string }
export interface CoverageDraft {
  sourceHash: string; paragraphId: string; shotIds: string[]; takeIds: string[]; note: string;
  disposition?: 'PROPOSED' | 'NEEDS_SHOT' | 'MAPPED' | 'NOT_APPLICABLE'; rationale?: string;
  productionElements?: import('../../local/contracts/script-breakdown.mjs').ProductionElement[];
}
export interface SourcePassageRef { paragraphId: string; textHash: string }
export interface SourceSelectionRequest {
  sourceHash: string; sceneId: string; shotIds: string[]; passages: SourcePassageRef[]; nonce: number;
}
export interface GenerationBrief {
  schemaVersion: 1; sourceHash: string; sceneId: string; title: string;
  handoffRef?: AuthoringInputRef;
  contextBundleRef?: AuthoringInputRef;
  sourcePassages?: SourcePassageRef[];
  shotIds: string[]; cellIds: string[]; initialFrameCellId: string | null; characterIds: string[];
  mediaInputs?: { sha256: string; role: 'SOURCE_VIDEO' | 'MOTION_REFERENCE' | 'AUDIO_REFERENCE'; inMs: number | null; outMs: number | null }[];
  prompt: string; settings: { route?: 'UNSELECTED' | 'DREAMINA' | 'HIGGSFIELD' | 'COMFYUI' | 'OTHER'; model: string; mode: 'UNCONFIRMED' | 'STANDARD' | 'LONG_VIDEO' | 'CLIP'; durationMs: number | null; aspectRatio: string; resolution: string };
  basisHash: string; status: 'DRAFT';
}
export interface WorkspaceRecord {
  id: string; kind: string; version: number; sha256: string; data: unknown; replayed?: boolean;
  reviewState?: { status: 'NEEDS_REVIEW' | 'CURRENT_CELL_BASIS'; changedCellIds: string[]; reason: string };
}
export interface Bootstrap {
  project: Project; records: WorkspaceRecord[];
  canonical?: { version: number; stateHash: string; sourceStatus: 'ADMITTED' | 'PENDING_OWNER_ADMISSION'; sourceRevision: Record<string, unknown> | null };
}
export interface CreativeBootstrap {
  project: CreativeProject; records: WorkspaceRecord[];
  canonical: { version: number; stateHash: string; sourceStatus: 'NO_SCREENPLAY'; sourceRevision: null };
}
export type WorkspaceBootstrap = Bootstrap | CreativeBootstrap;
export interface RecordInput<T = ScenePlan> { id: string; kind: string; expectedVersion: number | null; requestId: string; data: T }
export interface WorkspaceApi {
  draftRecovery?: import('./writingRecoveryApi').WritingRecoveryApi;
  bootstrap(): Promise<Bootstrap>;
  openWorkspace?(): Promise<WorkspaceBootstrap>;
  history?(id: string, project?: WorkspaceProject): Promise<WorkspaceRecord[]>;
  saveRecord(input: RecordInput<import('../../local/contracts/project-participation.mjs').ProjectParticipation | import('../../local/contracts/shot-direction.mjs').ShotDirection | ShotKeyframePlan | ComicDraft | AssetMarketProfile | import('./studioOperationApi').StudioOperation | import('./generationPlan').MovieSequence | ScenePlan | CastingDraft | StoryboardCellDraft | DocumentDraft | ScreenplayDraft | CreativeScreenplayDraft | AuthoringDraft | CreativeAuthoringDraft | ReviewResolution | ProductionHandoff | CameraObservation | GenerationBrief | ContextBundle | CoverageDraft | import('./nodeWorkflowModel').NodeWorkflowData | import('./projectLibraryModel').AssetCuration | import('./universeApi').UniverseDraft | import('./projectDirection').ProjectDirection>, project?: WorkspaceProject): Promise<WorkspaceRecord>;
  login(token: string): Promise<void>;
}
