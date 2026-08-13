/**
 * Filesystem access to the profile tree for node tooling.
 *
 * The app reads the same files through Vite's import.meta.glob; tooling runs
 * under plain `node` (type stripping), so it reads the directory itself and
 * shares the pure validate/merge/hash modules with the app. Runtime imports
 * must carry explicit .ts extensions for node ESM resolution.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateBase, validateDelta } from "../src/profiles/validate.ts";
import { mergeProfile, canonicalProfileJson, hashPolicy } from "../src/profiles/resolve.ts";
import type { SourceProfileBase, SourceProfileDelta } from "../src/profiles/schema.ts";
import type { RegisteredSourceProfile } from "../src/engine/adapter-types.ts";

export const PROFILES_DIR = new URL("../src/profiles", import.meta.url).pathname;
export const SOURCES_DIR = join(PROFILES_DIR, "sources");
export const MANIFEST_PATH = join(PROFILES_DIR, "policy-manifest.json");

export type ManifestEntry = { version: number; policyHash: string };
export type PolicyManifest = Record<string, ManifestEntry>;

export function readBase(): SourceProfileBase {
  const raw = JSON.parse(readFileSync(join(PROFILES_DIR, "base.json"), "utf8"));
  const result = validateBase(raw);
  if (!result.ok) {
    throw new Error(`base.json is invalid:\n- ${result.problems.join("\n- ")}`);
  }
  return result.value;
}

export function readDeltas(): Array<{ file: string; delta: SourceProfileDelta }> {
  return readdirSync(SOURCES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(SOURCES_DIR, name), "utf8"));
      const result = validateDelta(raw);
      if (!result.ok) {
        throw new Error(`sources/${name} is invalid:\n- ${result.problems.join("\n- ")}`);
      }
      if (result.value.id !== name.replace(/\.json$/, "")) {
        throw new Error(`sources/${name}: id "${result.value.id}" does not match the filename.`);
      }
      return { file: name, delta: result.value };
    });
}

export function resolveAll(): RegisteredSourceProfile[] {
  const base = readBase();
  return readDeltas().map(({ delta }) => mergeProfile(base, delta));
}

export function buildManifest(profiles: RegisteredSourceProfile[]): PolicyManifest {
  const manifest: PolicyManifest = {};
  for (const profile of [...profiles].sort((a, b) => a.id.localeCompare(b.id))) {
    manifest[profile.id] = {
      version: profile.version,
      policyHash: hashPolicy(canonicalProfileJson(profile))
    };
  }
  return manifest;
}

export function readManifest(): PolicyManifest | null {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}
