import { PREVIS_FPS } from './visualPrevis.mjs';

const mimeTypes = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
const maxBytes = 32 * 1024 * 1024;

export function previsRecordingType(canvas: HTMLCanvasElement) {
  if (typeof canvas.captureStream !== 'function' || typeof window.MediaRecorder?.isTypeSupported !== 'function') return undefined;
  return mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
}

export function recordPrevisGuide(
  canvas: HTMLCanvasElement, frameCount: number, draw: (frame: number) => void, signal: AbortSignal,
): Promise<Blob> {
  const mimeType = previsRecordingType(canvas);
  if (!mimeType) return Promise.reject(new Error('Video recording is unavailable in this viewer. You can still save the shot plan.'));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(PREVIS_FPS);
    const chunks: Blob[] = [];
    let bytes = 0;
    let animation = 0;
    let timer = 0;
    let start: number | undefined;
    let frame = -1;
    let reachedEnd = false;
    let complete = false;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      reject(error);
      return;
    }

    function finish(error?: unknown) {
      if (complete) return;
      complete = true;
      cancelAnimationFrame(animation);
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      document.removeEventListener('visibilitychange', visibility);
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach(track => track.stop());
      if (error !== undefined) reject(error);
      else resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    }

    function abort() { finish(signal.reason); }
    function visibility() {
      if (document.hidden) finish(new Error('Keep the 3D editor visible while recording. Start the guide again when ready.'));
    }

    function tick(now: number) {
      start ??= now;
      const position = Math.floor((now - start) * PREVIS_FPS / 1000);
      if (position >= frameCount && frame === frameCount - 1) {
        reachedEnd = true;
        if (recorder.state === 'recording') recorder.stop();
        return;
      }
      const target = Math.min(frameCount - 1, position);
      try {
        if (target !== frame) draw(target);
        frame = target;
      } catch (error) {
        finish(error);
        return;
      }
      animation = requestAnimationFrame(tick);
    }

    signal.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', visibility);
    recorder.addEventListener('dataavailable', event => {
      bytes += event.data.size;
      if (bytes > maxBytes) finish(new Error('The guide exceeded the local 32 MB recording limit.'));
      else if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', () => finish(new Error('The local encoder could not record this guide.')));
    recorder.addEventListener('stop', () => finish(bytes && reachedEnd ? undefined : new Error('The local encoder returned an incomplete video.')));
    timer = window.setTimeout(() => finish(new Error('The local recording did not finish.')), frameCount * 1000 / PREVIS_FPS + 5000);
    try {
      recorder.start();
      animation = requestAnimationFrame(tick);
    } catch (error) {
      finish(error);
    }
  });
}
