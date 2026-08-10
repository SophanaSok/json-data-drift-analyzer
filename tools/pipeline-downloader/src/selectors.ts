/**
 * ============================================================================
 * SITE CONFIGURATION — EVERY VALUE BELOW IS A PLACEHOLDER AND MUST BE FILLED IN
 * ============================================================================
 *
 * No details of the pipeline dashboard's UI were available when this was written, so
 * nothing here is a guess at a real selector. Each entry is set to `PLACEHOLDER`, and
 * the tool refuses to open a browser until every one has been replaced. That refusal is
 * deliberate: a plausible-looking invented selector would fail deep inside a run with a
 * confusing timeout, while an unfilled placeholder fails immediately and says so.
 *
 * To fill these in, open the dashboard by hand with the browser devtools and copy the
 * selectors. Prefer Playwright's user-facing forms over CSS chains tied to markup
 * structure — `getByLabel("Password")` survives a redesign that `div > form > input:nth-child(2)`
 * does not. Any string valid in `page.locator()` works here.
 *
 * Two entries are templates. `{botId}` and `{runTimestamp}` are substituted at runtime;
 * see `fillTemplate` below.
 */

import { DownloadError } from "./errors.ts";
import type { ExportKind } from "./naming.ts";

/** Sentinel for an unfilled value. Grep for it to find what is left to do. */
export const PLACEHOLDER = "TODO_FILL_IN";

export type SelectorConfig = {
  /** Path appended to PIPELINE_DASHBOARD_URL to reach the login form, e.g. "/login". */
  loginPath: string;
  /** The username or email field on the login form. */
  usernameField: string;
  /** The password field on the login form. */
  passwordField: string;
  /** The control that submits the login form. */
  submitButton: string;
  /**
   * Something that appears only once login has succeeded — an account menu, a sign-out
   * link. Waiting on this is how the tool tells a successful login from a rejected one,
   * so it must not exist on the login page itself.
   */
  loggedInMarker: string;
  /**
   * Something that appears only when login has *failed*, e.g. the form's error banner.
   * Optional: leave as PLACEHOLDER and a bad password shows up as a timeout on
   * `loggedInMarker` instead of a clean "auth" failure.
   */
  loginErrorMarker: string;
  /** Path to a bot's run list. Template: "/bots/{botId}/runs". */
  runsPath: string;
  /** The newest run's row in that list. Used for `--run latest`. */
  latestRunRow: string;
  /** A specific run's row. Template, e.g. "tr[data-run-timestamp='{runTimestamp}']". */
  runRow: string;
  /**
   * The element *within* a run row holding that run's timestamp. Read as text and used
   * verbatim in the filename, so it should be the timestamp alone, not a row of columns.
   */
  runTimestampCell: string;
  /** The control that starts the export download, per kind, scoped within a run row. */
  downloadControl: Record<ExportKind, string>;
};

export const selectorConfig: SelectorConfig = {
  loginPath: PLACEHOLDER,
  usernameField: PLACEHOLDER,
  passwordField: PLACEHOLDER,
  submitButton: PLACEHOLDER,
  loggedInMarker: PLACEHOLDER,
  loginErrorMarker: PLACEHOLDER,
  runsPath: PLACEHOLDER,
  latestRunRow: PLACEHOLDER,
  runRow: PLACEHOLDER,
  runTimestampCell: PLACEHOLDER,
  downloadControl: {
    candidate: PLACEHOLDER,
    reference: PLACEHOLDER
  }
};

/** Entries that may stay unfilled, and what is lost by leaving them. */
const OPTIONAL_KEYS = ["loginErrorMarker"] as const;

/**
 * List every entry still set to the placeholder, in dotted-path form.
 *
 * @returns e.g. `["loginPath", "downloadControl.candidate"]`; empty means ready to run
 */
export function unconfiguredSelectors(config: SelectorConfig = selectorConfig): string[] {
  const optional = new Set<string>(OPTIONAL_KEYS);
  const unfilled: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (optional.has(key)) continue;

    if (typeof value === "string") {
      if (value === PLACEHOLDER || value.trim().length === 0) unfilled.push(key);
      continue;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue === PLACEHOLDER || childValue.trim().length === 0) unfilled.push(`${key}.${childKey}`);
    }
  }

  return unfilled;
}

export function isConfigured(value: string): boolean {
  return value !== PLACEHOLDER && value.trim().length > 0;
}

/**
 * Substitute `{name}` placeholders in a selector or path template.
 *
 * @throws DownloadError `config` when the template references a value that was not supplied
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new DownloadError("config", `Template "${template}" references unknown value "{${name}}".`);
    }
    return value;
  });
}

/**
 * Fail before launching a browser if the tool has not been pointed at a real dashboard.
 *
 * @throws DownloadError `config` listing every unfilled entry
 */
export function assertSelectorsConfigured(config: SelectorConfig = selectorConfig): void {
  const unfilled = unconfiguredSelectors(config);
  if (unfilled.length === 0) return;

  throw new DownloadError(
    "config",
    `src/selectors.ts still has ${unfilled.length} placeholder value(s): ${unfilled.join(", ")}. ` +
      "Fill them in from the real dashboard before running a download."
  );
}
