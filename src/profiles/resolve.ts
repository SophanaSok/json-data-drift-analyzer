/**
 * Pure profile resolution: base + repo delta (+ optional local override) → one
 * resolved SourceProfile with an authoritative policy identity.
 *
 * Merge semantics are replace-per-key: a key present in the delta replaces the
 * base value wholesale (never a union, so a delta can remove a base entry);
 * the `quality` section merges one sub-key deeper by the same rule. An auditor
 * reconstructs any effective value by reading at most two files.
 *
 * No Vite, DOM, or Dexie imports — this module is shared by the app, the
 * analysis worker, and node tooling (tools/*.ts).
 */

import type { QualityProfile } from "../engine/types";
import type { RegisteredSourceProfile } from "../engine/adapter-types";
import type { ProfileOverride, SourceProfileBase, SourceProfileDelta } from "./schema";

/**
 * A profile whose policy identity is pinned. `policyHash` covers the full
 * resolved content (base + delta + any override), so it — not the numeric
 * version alone — is what cache keys and staleness checks must compare.
 */
export type ResolvedSourceProfile = RegisteredSourceProfile & {
  /** Revision of the applied local override; 0 when none is active. */
  overrideRevision: number;
  /** FNV-1a 64-bit hash of the canonically serialized resolved profile. */
  policyHash: string;
};

export function mergeProfile(base: SourceProfileBase, delta: SourceProfileDelta): RegisteredSourceProfile {
  const { quality: qualityDelta, ...topLevel } = delta;
  return {
    ...base,
    ...definedEntries(topLevel),
    quality: { ...base.quality, ...definedEntries(qualityDelta ?? {}) }
  } as RegisteredSourceProfile;
}

/**
 * Apply a local override to a repo-resolved profile and stamp the policy
 * identity. A stale override (written against an older repo version) is NOT
 * applied — a repo policy bump must not silently re-apply old tweaks — and is
 * reported via `overrideStale` for the UI to surface.
 */
export function resolveEffectiveProfile(
  repoProfile: RegisteredSourceProfile,
  override: ProfileOverride | null
): { profile: ResolvedSourceProfile; overrideApplied: boolean; overrideStale: boolean } {
  const stale = override !== null && override.baseVersion !== repoProfile.version;
  const active = override !== null && !stale ? override : null;

  let merged: RegisteredSourceProfile = repoProfile;
  if (active) {
    const { quality: qualityDelta, ...topLevel } = active.delta;
    merged = {
      ...repoProfile,
      ...definedEntries(topLevel),
      quality: { ...repoProfile.quality, ...definedEntries(qualityDelta ?? {}) }
    } as RegisteredSourceProfile;
  }

  const overrideRevision = active ? active.revision : 0;
  const profile: ResolvedSourceProfile = {
    ...merged,
    overrideRevision,
    policyHash: hashPolicy(canonicalProfileJson(merged))
  };
  return { profile, overrideApplied: active !== null, overrideStale: stale };
}

/** Derive the engine's QualityProfile view from a resolved source profile. */
export function toQualityProfile(profile: ResolvedSourceProfile): QualityProfile {
  return {
    id: profile.id,
    version: profile.version,
    name: profile.displayName ?? profile.id,
    ...profile.quality
  };
}

/**
 * Deterministic serialization for hashing: object keys sorted recursively, so
 * the hash depends on content, never on key order in a JSON file.
 */
export function canonicalProfileJson(profile: RegisteredSourceProfile): string {
  return JSON.stringify(sortKeysDeep(profile));
}

/** FNV-1a 64-bit over UTF-16 code units, as a 16-hex-char string. Identity tag, not cryptography. */
export function hashPolicy(canonical: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * A key set to `undefined` in a delta must not clobber the base value — JSON
 * files cannot express undefined, but TypeScript call sites can.
 */
function definedEntries<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
