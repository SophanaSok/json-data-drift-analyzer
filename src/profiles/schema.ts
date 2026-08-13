/**
 * File shapes for the base + delta profile layout.
 *
 * `src/profiles/base.json` holds what the sources share; each source ships a
 * small delta at `src/profiles/sources/<id>.json` containing only what differs.
 * A delta key, when present, REPLACES the base value wholesale (the `quality`
 * section merges one sub-key deeper) — never a union, so a delta can remove a
 * base entry and an auditor reconstructs effective policy from at most two
 * values.
 *
 * Four keys are deliberately absent from the base and required in every delta:
 * `id`, `sourceUrl`, `version`, and `safeBackfillFields`. Backfill approval is
 * per-source (AGENTS.md rules 4 and 6) — an inherited approval would be an
 * approval no human made for that source, so even "no approvals yet" must be
 * stated explicitly as `[]`.
 */

import type { ProfileDetectionHints, QualitySection, RegisteredSourceProfile } from "../engine/adapter-types";

/** Shape of `src/profiles/base.json`: shared defaults, no source identity. */
export type SourceProfileBase = Omit<
  RegisteredSourceProfile,
  "id" | "sourceUrl" | "displayName" | "agency" | "version" | "safeBackfillFields" | "notes" | "detection"
>;

/** Shape of `src/profiles/sources/<id>.json`: one per source. */
export type SourceProfileDelta = {
  /** Must equal the filename stem — enforced by the invariant test suite. */
  id: string;
  /** Required and unique across deltas. */
  sourceUrl: string;
  /** Required, >= 1. Bump on any policy change (AGENTS.md rule 7). */
  version: number;
  /**
   * Required even when empty: absence is a validation error, so every
   * onboarder explicitly states "no fields approved for backfill yet".
   */
  safeBackfillFields: string[];
  /** Per-source approval history and evidence live here, never in the base. */
  notes?: string[];
  displayName?: string;
  agency?: string;
  detection?: ProfileDetectionHints;
  /** Merged per sub-key against the base's quality section. */
  quality?: Partial<QualitySection>;
} & Partial<Omit<SourceProfileBase, "quality">>;

/**
 * The delta an in-app override may apply on top of a repo profile. Identity
 * and repo version are not overridable — an override tweaks policy for the
 * source it is stored under; it cannot re-point or re-version the profile.
 */
export type ProfileOverrideDelta = Partial<Omit<SourceProfileDelta, "id" | "sourceUrl" | "version">>;

/**
 * A locally stored override, persisted in the `profileOverrides` Dexie table.
 * Defined here (not in src/db) so the pure resolver stays importable from the
 * worker and from node tooling without touching Dexie.
 */
export type ProfileOverride = {
  /** The repo profile this override applies to. Primary key. */
  profileId: string;
  /** Monotonic per-profile revision, starting at 1, incremented on each save. */
  revision: number;
  /**
   * The repo profile version the override was written against. When the repo
   * version moves past it, the override is STALE and is not applied — a repo
   * policy bump must not silently re-apply tweaks written against old policy.
   */
  baseVersion: number;
  delta: ProfileOverrideDelta;
  /** Required free-text rationale — the override's audit record (rule 7). */
  reason: string;
  /** ISO-8601 timestamp of the last save. */
  updatedAt: string;
};
