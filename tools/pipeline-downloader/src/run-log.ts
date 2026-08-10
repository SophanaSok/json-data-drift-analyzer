/**
 * Append-only CSV history of every attempted download.
 *
 * CSV rather than JSON so it opens in a spreadsheet and appends without rewriting the
 * file. That choice brings two hazards, both handled here: fields containing commas,
 * quotes, or newlines must be quoted (RFC 4180), and a field starting with `=`, `+`,
 * `-`, or `@` is executed as a formula by Excel and Sheets, so it is prefixed with an
 * apostrophe.
 *
 * The log records what happened, never what was downloaded. No credentials, no cookies,
 * no record contents — only the identifiers needed to reconstruct which command was run
 * and how it ended. Failure messages arrive already redacted and truncated.
 *
 * Formatting is separated from writing so the interesting half is testable without
 * touching a filesystem.
 */

import fs from "node:fs/promises";
import { summarizeDetail } from "./logging.ts";

export const RUN_LOG_COLUMNS = [
  "timestamp",
  "bot_id",
  "requested_run",
  "resolved_run",
  "file_path",
  "outcome",
  "error_category",
  "message"
] as const;

export type RunOutcome = "success" | "failure";

export type RunLogEntry = {
  /** ISO 8601, supplied by the caller so tests are not at the mercy of the clock. */
  timestamp: string;
  botId: string;
  /** What was asked for: "latest" or the timestamp given on the command line. */
  requestedRun: string;
  /** The concrete run that was downloaded. Empty when it was never resolved. */
  resolvedRun: string;
  /** Empty when no file was written. */
  filePath: string;
  outcome: RunOutcome;
  /** Empty on success. */
  errorCategory: string;
  /** Short, already redacted. Empty is fine. */
  message: string;
};

/** The Unicode control category, as a property escape so no control-character range appears here. */
const CONTROL_CHARACTERS = /\p{Cc}+/gu;
const NEEDS_QUOTING = /[",]/;
const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Escape one value for a CSV cell.
 *
 * Control characters are flattened to spaces first: a stray carriage return inside a
 * cell splits the row for some readers even when the field is quoted, and no value this
 * tool records has any business containing one.
 */
export function formatCsvField(value: string): string {
  const flattened = value.replace(CONTROL_CHARACTERS, " ").trim();

  // Neutralize spreadsheet formula injection. The apostrophe is visible in the raw file
  // but is consumed by the spreadsheet, so the cell still reads correctly.
  const safe = FORMULA_PREFIXES.some((prefix) => flattened.startsWith(prefix)) ? `'${flattened}` : flattened;

  if (!NEEDS_QUOTING.test(safe)) return safe;
  return `"${safe.split('"').join('""')}"`;
}

export function runLogHeader(): string {
  return RUN_LOG_COLUMNS.join(",");
}

export function formatRunLogRow(entry: RunLogEntry): string {
  return [
    entry.timestamp,
    entry.botId,
    entry.requestedRun,
    entry.resolvedRun,
    entry.filePath,
    entry.outcome,
    entry.errorCategory,
    summarizeDetail(entry.message)
  ]
    .map(formatCsvField)
    .join(",");
}

/**
 * Append one row, writing the header first if the file is new or empty.
 *
 * A failure to record history must not mask the result of the run itself, so this
 * reports rather than throws.
 *
 * @returns true when the row was written
 */
export async function appendRunLogEntry(logPath: string, entry: RunLogEntry): Promise<boolean> {
  try {
    const existing = await fs.stat(logPath).catch(() => null);
    const needsHeader = existing === null || existing.size === 0;
    const row = `${needsHeader ? `${runLogHeader()}\n` : ""}${formatRunLogRow(entry)}\n`;
    await fs.appendFile(logPath, row, "utf8");
    return true;
  } catch {
    return false;
  }
}
