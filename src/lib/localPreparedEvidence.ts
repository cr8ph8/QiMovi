import type { LocalReadableFile } from "@/lib/episodeProductionScript";

export interface LocalPreparedEvidence {
  fileName: string;
  sha256: string;
  schemaVersion: string;
  jsonBytes: Uint8Array;
}

export function cloneLocalPreparedEvidence(
  evidence: LocalPreparedEvidence,
): LocalPreparedEvidence {
  return {
    ...evidence,
    jsonBytes: evidence.jsonBytes.slice(),
  };
}

export function localPreparedEvidenceAsReadableFile(
  evidence: LocalPreparedEvidence,
): LocalReadableFile {
  const snapshot = evidence.jsonBytes.slice();
  return {
    name: evidence.fileName,
    size: snapshot.byteLength,
    async arrayBuffer() {
      const copy = snapshot.slice();
      return copy.buffer.slice(
        copy.byteOffset,
        copy.byteOffset + copy.byteLength,
      ) as ArrayBuffer;
    },
  };
}
