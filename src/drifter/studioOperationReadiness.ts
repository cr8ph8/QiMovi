import type { HiggsfieldPlannedMedia } from './higgsfieldToolsApi';

export interface OperationReadinessCheck { code: string; status: 'PASS' | 'NEEDED' | 'BLOCKED'; message: string }
export interface OperationReadiness { title: string; executable: false; checks: OperationReadinessCheck[]; next: string }
export const OPERATION_QUALIFICATION = Object.freeze({
  video_analysis_create: { title: 'Footage analysis', runner: 'NOT_IMPLEMENTED', billing: 'NO_QUOTE_INPUT_ADVERTISED', next: 'Qualify analysis submission, status recovery and result retention, then establish its billing terms before allowing a remote run.' },
  voice_change: { title: 'Change a video voice', runner: 'NOT_IMPLEMENTED', billing: 'NO_QUOTE_INPUT_ADVERTISED', next: 'Qualify the source-video and voice contract, obtain a supported price check, then connect one-shot submission and returned media.' },
  marketing_create_brand_kit: { title: 'Create a brand identity', runner: 'NOT_IMPLEMENTED', billing: 'NOT_ESTABLISHED', next: 'Review the exact brand payload and qualify durable creation and response recovery before creating a provider record.' },
});
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validAnalysisYoutubeUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['youtube.com','www.youtube.com','youtu.be'].includes(url.hostname) && (url.hostname === 'youtu.be' ? url.pathname.length > 1 : Boolean(url.searchParams.get('v')) || /^\/(shorts|live|embed)\/[^/]+/.test(url.pathname)); } catch { return false; }
}
/** A local input check, never a provider call or a live entitlement/price claim.
 * The advertised connector has no price-only input for these operations. Generic
 * response cost fields are not evidence that sending get_cost is supported. */
export function operationReadiness(taskId: string, settings: Record<string, unknown>, medias: HiggsfieldPlannedMedia[]): OperationReadiness | null {
  const qualification = OPERATION_QUALIFICATION[taskId as keyof typeof OPERATION_QUALIFICATION];
  if (!qualification) return null;
  const checks: OperationReadinessCheck[] = [], add = (code: string, pass: boolean, yes: string, no: string) => checks.push({ code, status: pass ? 'PASS' : 'NEEDED', message: pass ? yes : no });
  if (taskId === 'video_analysis_create') {
    const hasUrl = typeof settings.youtube_url === 'string' && Boolean(settings.youtube_url.trim()), oneVideo = medias.length === 1 && medias[0].role === 'video' && medias[0].mimeType.startsWith('video/');
    add('ANALYSIS_ONE_SOURCE', hasUrl ? medias.length === 0 && validAnalysisYoutubeUrl(settings.youtube_url) : oneVideo, hasUrl ? 'One YouTube source link is prepared; it has not been fetched.' : 'One retained source video is selected; its provider upload is not yet confirmed.', 'Choose exactly one retained video OR one valid HTTPS YouTube video link. Remove other media references.');
    add('ANALYSIS_EXACT_ARGUMENTS', Object.keys(settings).every(key => key === 'youtube_url'), 'Analysis settings contain only the selected source link.', 'Remove unrelated operation data. Uploaded video IDs must come from a verified upload receipt, not a pasted ID.');
  } else if (taskId === 'voice_change') {
    add('REVOICE_SOURCE_VIDEO', medias.length === 1 && medias[0].role === 'video' && medias[0].mimeType.startsWith('video/'), 'One retained video is selected for its original timing and visuals.', 'Select exactly one retained video. Image and audio-only references cannot supply this operation.');
    add('REVOICE_SELECTED_VOICE', typeof settings.voice_id === 'string' && Boolean(settings.voice_id.trim()) && ['preset','element'].includes(String(settings.voice_type)), 'An explicit voice identity and type are selected; provider availability still needs a fresh check.', 'Choose a provider voice and its type. A voice name alone cannot identify the target.');
    add('REVOICE_EXACT_ARGUMENTS', Object.keys(settings).every(key => ['voice_id','voice_type','voiceName'].includes(key)), 'Revoice has no generated-dialogue prompt or count input. Notes remain local.', 'Remove unrelated operation data. This tool accepts a verified video ID and voice identity, not prompt/count settings.');
  } else {
    const brand = settings.brand_kit;
    add('BRAND_PROVIDED_DATA', object(brand) && Object.keys(brand).length > 0, 'A user-supplied brand payload is prepared for review.', 'Add brand_kit data in the operation fields. Websites and third-party imagery will not be scraped or inferred.');
    add('BRAND_EXACT_ARGUMENTS', Object.keys(settings).every(key => key === 'brand_kit') && medias.length === 0, 'Creation is scoped to the brand payload.', 'Prepare the brand_kit payload only. Local files need a separate verified upload path before their URLs can be included.');
  }
  checks.push({ code: 'OPERATION_RUNNER_UNQUALIFIED', status: 'BLOCKED', message: 'This operation has no qualified submission and recovery runner in the desktop app. Saving keeps a preparation draft only.' });
  checks.push({ code: 'OPERATION_BILLING_UNCONFIRMED', status: 'BLOCKED', message: qualification.billing === 'NO_QUOTE_INPUT_ADVERTISED' ? 'The advertised operation input has no supported cost-only option. Pricing and a spending gate are unconfirmed; it is not assumed free.' : 'The creation tool does not establish billing terms. Saving this local draft authorizes no remote creation.' });
  return { title: qualification.title, executable: false, checks, next: qualification.next };
}
