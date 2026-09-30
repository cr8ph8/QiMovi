/** Fixed by local/integrations/three-d/stage-kit.mjs for both rehearsal targets. */
export const STAGE_SENSOR_WIDTH_MM = 36;

/** Ideal rectilinear angular coverage; excludes crop, distortion and focus breathing. */
export function horizontalFieldOfViewDegrees(focalLengthMm: number, sensorWidthMm: number): number | null {
  if (!Number.isFinite(focalLengthMm) || focalLengthMm <= 0
    || !Number.isFinite(sensorWidthMm) || sensorWidthMm <= 0) return null;
  return 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)) * 180 / Math.PI;
}
