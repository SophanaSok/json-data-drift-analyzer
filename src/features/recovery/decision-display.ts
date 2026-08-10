/**
 * Display helpers shared by the decision components.
 *
 * Separate from the components so both can import them without breaking fast
 * refresh, which requires a component file to export only components.
 */

import type { DecisionAction } from "../../engine/decisions";

export const ACTION_LABEL: Record<DecisionAction, string> = {
  backfill: "use reference",
  keep_candidate: "keep candidate",
  use_custom: "custom value"
};

/** One-line, length-capped preview of a cell value. */
export function preview(value: unknown, limit = 48): string {
  if (value === null || value === undefined) return "(absent)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.trim() === "") return "(blank)";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
