import type { ChangeKind } from "../engine/types";

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value === "" ? '""' : JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2);
}

export function changeKindLabel(kind: ChangeKind): string {
  return kind;
}

export function changeKindStyles(kind: ChangeKind): { row: string; baseline: string; latest: string } {
  switch (kind) {
    case "removed":
    case "emptied":
      return {
        row: "bg-red-50",
        baseline: "bg-red-100 text-red-900",
        latest: "bg-red-50 text-red-700 line-through"
      };
    case "added":
    case "restored":
      return {
        row: "bg-emerald-50",
        baseline: "bg-slate-50 text-slate-400",
        latest: "bg-emerald-100 text-emerald-900"
      };
    default:
      return {
        row: "bg-amber-50",
        baseline: "bg-amber-100 text-amber-900",
        latest: "bg-amber-100 text-amber-900"
      };
  }
}

export function isFieldPathChanged(fieldPath: string, changedPaths: Set<string>): boolean {
  if (changedPaths.has(fieldPath)) return true;
  for (const path of changedPaths) {
    if (path.startsWith(`${fieldPath}.`) || path.startsWith(`${fieldPath}[`)) return true;
  }
  return false;
}

export function collectTopLevelKeys(
  baseline?: Record<string, unknown>,
  latest?: Record<string, unknown>
): string[] {
  return [...new Set([...Object.keys(baseline ?? {}), ...Object.keys(latest ?? {})])].sort();
}
