/**
 * Clipboard access that cannot throw.
 *
 * `navigator.clipboard` is undefined outside a secure context and its write can be
 * rejected without a user gesture, so a failed copy is a normal outcome rather than
 * an error. Callers get a boolean and can tell the user plainly.
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
