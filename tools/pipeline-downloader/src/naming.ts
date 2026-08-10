/**
 * Deterministic names for downloaded exports.
 *
 * The contract is `{bot-id}_{run-timestamp}_{candidate|reference}.json`. Deterministic
 * means the same run downloaded twice produces the same path — which is what makes a
 * re-download detectable as a re-download rather than silently producing `export (1).json`.
 *
 * Both variable parts are attacker-adjacent: the bot id comes from a command line and
 * the run timestamp is read out of a web page. Either could carry `/` or `..`, so both
 * are validated here and the assembled path is checked again against the download
 * directory before anything is written.
 */

import path from "node:path";
import { DownloadError } from "./errors.ts";

export const EXPORT_KINDS = ["candidate", "reference"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: string): value is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(value);
}

/**
 * Bot ids are used verbatim in the filename, so the accepted set is the one that is
 * safe there: no separators, no leading dot, nothing that needs escaping.
 */
const BOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidBotId(value: string): boolean {
  return BOT_ID_PATTERN.test(value) && !value.includes("..");
}

/** Longest canonical timestamp segment; a longer one is a sign of a mis-read page. */
const MAX_RUN_TIMESTAMP_LENGTH = 64;

/**
 * Reduce a run timestamp to a filename-safe token.
 *
 * The dashboard's timestamp format is unknown, so this deliberately does not parse or
 * re-format dates — inventing a format would mean the filename no longer matches what
 * the dashboard displays. It only replaces runs of unsafe characters with `-`, which is
 * stable: the same displayed timestamp always maps to the same token.
 *
 * `2026-07-15 08:02:12` becomes `2026-07-15-08-02-12`, and
 * `2026-07-15T08:02:12Z` becomes `2026-07-15T08-02-12Z`. Those are different tokens for
 * the same instant, so a dashboard that changes its display format changes the
 * filenames too. That is a real limitation, and it is preferable to guessing.
 *
 * @throws DownloadError `config` when nothing usable is left
 */
export function canonicalizeRunTimestamp(raw: string): string {
  const canonical = raw
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_RUN_TIMESTAMP_LENGTH)
    .replace(/-+$/g, "");

  if (canonical.length === 0) {
    throw new DownloadError("config", `Run timestamp "${raw}" contains no usable characters.`);
  }
  return canonical;
}

export type FilenameInput = {
  botId: string;
  /** A concrete run timestamp. Never the literal "latest" — resolve that first. */
  runTimestamp: string;
  kind: ExportKind;
};

/**
 * Build the download filename.
 *
 * @throws DownloadError `config` for a bot id that cannot appear in a filename, or for
 *   an unresolved `latest`
 */
export function buildDownloadFilename(input: FilenameInput): string {
  if (!isValidBotId(input.botId)) {
    throw new DownloadError(
      "config",
      `Bot id "${input.botId}" is not usable in a filename. Use letters, digits, dot, dash, or underscore.`
    );
  }

  // A file named `bot_latest_candidate.json` would be indistinguishable between runs,
  // which defeats the entire point of a deterministic name.
  if (input.runTimestamp.trim().toLowerCase() === "latest") {
    throw new DownloadError("config", 'The run timestamp is still "latest"; resolve it from the dashboard first.');
  }

  return `${input.botId}_${canonicalizeRunTimestamp(input.runTimestamp)}_${input.kind}.json`;
}

/**
 * Join a filename onto the download directory, refusing anything that escapes it.
 *
 * `buildDownloadFilename` already rejects separators, so this is the second lock on the
 * same door — cheap, and it stays correct if the validation above is ever loosened.
 *
 * @throws DownloadError `filesystem` when the result would land outside `incomingDir`
 */
export function resolveDownloadPath(incomingDir: string, filename: string): string {
  const directory = path.resolve(incomingDir);
  const resolved = path.resolve(directory, filename);

  if (path.dirname(resolved) !== directory) {
    throw new DownloadError("filesystem", `Refusing to write outside the download directory: "${filename}".`);
  }
  return resolved;
}
