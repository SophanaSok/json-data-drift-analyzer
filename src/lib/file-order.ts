import {
  assessFileOrder,
  BASELINE_DATE_NEWER_TOAST_MESSAGE,
  type FileOrderAssessment
} from "../engine/export-metadata";
import { useToastStore } from "../stores/toast-store";

export function assessFileOrderFromJson(
  baselineText: string,
  latestText: string,
  baselineFileName: string,
  latestFileName: string,
  collectionPath = "Export"
): FileOrderAssessment {
  const baseline = JSON.parse(baselineText) as unknown;
  const latest = JSON.parse(latestText) as unknown;
  return assessFileOrder(
    baseline,
    latest,
    baselineFileName,
    latestFileName,
    collectionPath
  );
}

export function notifyReversedFileOrder(assessment: FileOrderAssessment) {
  if (assessment.status !== "reversed") return;
  useToastStore.getState().showToast(BASELINE_DATE_NEWER_TOAST_MESSAGE, "warning");
}
