/**
 * One-file hand-back: every export artifact zipped together.
 *
 * Kept out of export.ts so the zip dependency is loaded only by the page that
 * offers the download, never by the analysis worker or the headless runner.
 * Pure: bytes in, bytes out, nothing touches the DOM here.
 */

import { strToU8, unzipSync, zipSync } from "fflate";
import type { ExportArtifact } from "./export";
import { slugify, timestampSlug } from "./export";

/** Deterministic: same artifacts in, byte-identical archive out. */
const FIXED_ZIP_MTIME = new Date("2000-01-01T00:00:00Z");

export function buildZipArchive(artifacts: ExportArtifact[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; mtime: Date }]> = {};
  for (const artifact of artifacts) {
    entries[artifact.fileName] = [strToU8(artifact.content), { level: 6, mtime: FIXED_ZIP_MTIME }];
  }
  return zipSync(entries);
}

export function zipFileName(profileId: string, generatedAt: string): string {
  return `${slugify(profileId)}-bundle-${timestampSlug(generatedAt)}.zip`;
}

/** Read an archive back; used by tests and by anyone verifying a hand-back. */
export function readZipArchive(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    out[name] = new TextDecoder().decode(data);
  }
  return out;
}
