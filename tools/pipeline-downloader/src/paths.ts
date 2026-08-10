/**
 * Where the tool writes.
 *
 * Anchored to this package rather than to `process.cwd()`, so a run started from the
 * repository root and a run started from this directory put the file in the same place.
 * Both destinations are gitignored: downloaded exports are real pipeline data, and the
 * run log is local operational history.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Downloads land here. Nothing else in the repository reads this directory yet. */
export const INCOMING_DIR = path.join(TOOL_ROOT, "incoming");

export const RUN_LOG_PATH = path.join(TOOL_ROOT, "run-log.csv");

/** Shown in console output so the operator sees a short path, not an absolute one. */
export function relativeToTool(target: string): string {
  const relative = path.relative(TOOL_ROOT, target);
  return relative.startsWith("..") ? target : relative;
}
