/**
 * Remember the last-used source profile across sessions.
 *
 * A preference, not policy: losing it (private browsing, denied storage) only
 * means the picker starts from the default again. The stored id is validated
 * against the registry by the caller — a stale id from a removed profile must
 * fall back, never crash.
 */

import { readStoredText, writeStoredText } from "../../lib/safe-storage";

const LAST_PROFILE_KEY = "last-source-profile-id";

export function loadLastProfileId(): string | null {
  const stored = readStoredText(LAST_PROFILE_KEY);
  return stored !== null && stored.length > 0 ? stored : null;
}

export function saveLastProfileId(id: string): void {
  writeStoredText(LAST_PROFILE_KEY, id);
}
