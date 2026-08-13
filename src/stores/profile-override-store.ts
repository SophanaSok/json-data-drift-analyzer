import { create } from "zustand";

/**
 * Cross-page notification that the profile-override table changed.
 *
 * IndexedDB has no reactivity of its own; every writer (the Profiles page)
 * bumps `revision` after a successful write or delete, and useEffectiveProfile
 * re-reads when it changes. The counter carries no data — the table stays the
 * single source of truth.
 */
type ProfileOverrideState = {
  revision: number;
  notifyOverridesChanged: () => void;
};

export const useProfileOverrideStore = create<ProfileOverrideState>((set) => ({
  revision: 0,
  notifyOverridesChanged: () => set((state) => ({ revision: state.revision + 1 }))
}));
