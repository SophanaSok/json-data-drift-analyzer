import { useEffect, useMemo, useState } from "react";
import { getProfileOverride, type SavedProfileOverride } from "../../db";
import { getProfile } from "../../profiles";
import { resolveEffectiveProfile, type ResolvedSourceProfile } from "../../profiles/resolve";
import type { RegisteredSourceProfile } from "../../engine/adapter-types";
import { useProfileOverrideStore } from "../../stores/profile-override-store";

export type EffectiveProfileState = {
  /** The resolved, policy-stamped profile; null when the id is unknown. */
  profile: ResolvedSourceProfile | null;
  /** The repo profile (base + delta) before any local override. */
  repoProfile: RegisteredSourceProfile | null;
  /** The stored override row, applied or not; null when none exists. */
  override: SavedProfileOverride | null;
  /** True when an override exists and was applied to `profile`. */
  overrideActive: boolean;
  /** True when an override exists but was written against an older repo version and is NOT applied. */
  overrideStale: boolean;
  /** True until the override read has settled. `profile` is already usable —
   * it holds the no-override resolution — but a caller about to pin the policy
   * identity (cache key, worker payload) must wait for this to clear. */
  loading: boolean;
};

/**
 * Resolve a profile id to its effective policy: base + repo delta + any local
 * override from IndexedDB, stamped with its policy identity.
 *
 * Resolution is synchronous and repo-only at first render (no flash of "no
 * profile"), then re-resolves when the override read lands and whenever the
 * override store signals a change. A failing IndexedDB degrades to the repo
 * policy — the analysis must still run, and the policy hash records what
 * actually governed either way.
 */
export function useEffectiveProfile(profileId: string | null): EffectiveProfileState {
  const revision = useProfileOverrideStore((state) => state.revision);
  const repoProfile = profileId ? getProfile(profileId) : null;
  const [read, setRead] = useState<{ key: string; override: SavedProfileOverride | null } | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    void getProfileOverride(profileId).then((override) => {
      if (!cancelled) setRead({ key: `${profileId}:${revision}`, override });
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, revision]);

  return useMemo(() => {
    if (!repoProfile || !profileId) {
      return { profile: null, repoProfile: null, override: null, overrideActive: false, overrideStale: false, loading: false };
    }
    const settled = read !== null && read.key === `${profileId}:${revision}`;
    const override = settled ? read.override : null;
    const resolution = resolveEffectiveProfile(repoProfile, override);
    return {
      profile: resolution.profile,
      repoProfile,
      override,
      overrideActive: resolution.overrideApplied,
      overrideStale: resolution.overrideStale,
      loading: !settled
    };
  }, [repoProfile, profileId, read, revision]);
}
