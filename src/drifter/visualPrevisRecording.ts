import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny';
import { PREVIS_FPS } from './visualPrevis.mjs';

export type PrevisCodec = 'avc' | 'vp8';
const bitrate = 3_000_000;

export async function choosePrevisCodec(canvas: HTMLCanvasElement): Promise<PrevisCodec | undefined> {
  const options = { width: canvas.width, height: canvas.height, frameRate: PREVIS_FPS, bitrate };
  if (await canEncodeVideo('avc', options)) return 'avc';
  if (await canEncodeVideo('vp8', options)) return 'vp8';
}

export async function exportPrevisGuide(
  canvas: HTMLCanvasElement, codec: PrevisCodec, frameCount: number, draw: (frame: number) => void, signal: AbortSignal,
): Promise<Blob> {
  const format = codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, { codec, bitrate });
  output.addVideoTrack(source, { frameRate: PREVIS_FPS });
  const stop = () => { void output.cancel().catch(() => undefined); };
  signal.throwIfAborted();
  signal.addEventListener('abort', stop, { once: true });
  try {
    await output.start();
    for (let frame = 0; frame < frameCount; frame += 1) {
      signal.throwIfAborted();
      draw(frame);
      await source.add(frame / PREVIS_FPS, 1 / PREVIS_FPS);
      // Give the UI a chance to paint progress and accept cancellation.
      if (frame % 8 === 7) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('The local encoder returned an empty video.');
    return new Blob([target.buffer], { type: codec === 'avc' ? 'video/mp4' : 'video/webm' });
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
