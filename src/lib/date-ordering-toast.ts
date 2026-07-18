import {
  BASELINE_DATE_NEWER_TOAST_MESSAGE,
  extractExportDates,
  findDateOrderingIssues,
  hasDateOrderingIssue,
  type DateOrderingIssue
} from "../engine/export-metadata";
import { useToastStore } from "../stores/toast-store";

export function findDateOrderingIssuesFromJson(baselineText: string, latestText: string): DateOrderingIssue[] {
  const baseline = JSON.parse(baselineText) as unknown;
  const latest = JSON.parse(latestText) as unknown;
  return findDateOrderingIssues(extractExportDates(baseline), extractExportDates(latest));
}

export function notifyDateOrderingIssues(issues: DateOrderingIssue[]) {
  if (!hasDateOrderingIssue(issues)) return;
  useToastStore.getState().showToast(BASELINE_DATE_NEWER_TOAST_MESSAGE, "warning");
}
