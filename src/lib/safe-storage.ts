/**
 * localStorage access that cannot throw.
 *
 * A `typeof window === "undefined"` guard is not sufficient. A browser can expose
 * `window` while denying storage — Safari private browsing, blocked cookies, and
 * partitioned third-party iframes all either throw a SecurityError on the
 * `window.localStorage` getter itself or throw from its methods. Writes can also throw
 * QuotaExceededError once the origin's storage budget is full.
 *
 * Storage here backs UI preferences only (column widths). Losing them is cosmetic, so
 * every failure degrades to "no stored value" rather than propagating.
 */

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    // The getter itself can throw when storage is denied.
    const storage = window.localStorage;
    return typeof storage?.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

/**
 * Read a string from localStorage, or null if unavailable, unset, or inaccessible.
 */
export function readStoredText(key: string): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a string to localStorage. Silently no-ops when storage is unavailable or the
 * write is rejected (e.g. quota exceeded).
 *
 * @returns true when the value was stored
 */
export function writeStoredText(key: string, value: string): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
