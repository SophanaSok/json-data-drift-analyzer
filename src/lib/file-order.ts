import {
  assessFileOrder,
  BASELINE_DATE_NEWER_TOAST_MESSAGE,
  type FileOrderAssessment
} from "../engine/export-metadata";
import { stripBOM } from "../engine/source-loader";
import { useToastStore } from "../stores/toast-store";

export function assessFileOrderFromJson(
  baselineText: string,
  latestText: string,
  baselineFileName: string,
  latestFileName: string,
  collectionPath = "Export"
): FileOrderAssessment {
  // Strips a UTF-8 BOM before parsing; real scraper exports ship with one. Still
  // throws on genuinely malformed JSON, which the caller surfaces to the user.
  const baseline = JSON.parse(stripBOM(baselineText).content) as unknown;
  const latest = JSON.parse(stripBOM(latestText).content) as unknown;
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
