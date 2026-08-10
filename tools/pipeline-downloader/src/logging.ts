/**
 * Console output that cannot leak the credentials it was configured with.
 *
 * Nothing in this tool deliberately prints a secret, but the messages that reach the
 * console are not all ours: Playwright errors quote URLs, selectors, and occasionally
 * page content. So every line goes through one redaction pass on the way out, and
 * untrusted text is truncated before it gets there.
 *
 * Two things are never printed at all, by construction rather than by filtering: the
 * downloaded JSON (only its byte count is reported) and session state (no cookie, token,
 * or `storageState` is ever read back out of the browser context).
 */

/** Untrusted error text is cut to this before it is logged or written to the run log. */
export const MAX_DETAIL_LENGTH = 200;

/**
 * Replace every occurrence of each secret with a marker.
 *
 * Empty strings are skipped: splitting on "" would insert the marker between every
 * character of the message.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), text);
}

/**
 * Flatten untrusted text to one bounded, single-line fragment.
 *
 * Newlines are collapsed because a Playwright timeout message is a multi-line report,
 * and pasting that whole thing into a CSV cell or a one-line console summary helps
 * nobody.
 */
export function summarizeDetail(text: string, maxLength = MAX_DETAIL_LENGTH): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, maxLength - 1)}…`;
}

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  /** Redact without printing — for text that is headed to the run log instead. */
  clean: (text: string) => string;
};

/**
 * @param secrets values that must never appear in output; typically the password and
 *   username read from the environment
 */
export function createLogger(secrets: string[]): Logger {
  const clean = (text: string) => redactSecrets(text, secrets);
  return {
    info: (message) => console.log(clean(message)),
    warn: (message) => console.warn(clean(message)),
    error: (message) => console.error(clean(message)),
    clean
  };
}
