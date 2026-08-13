import {
  assessFileOrder,
  BASELINE_DATE_NEWER_TOAST_MESSAGE,
  type FileOrderAssessment
} from "../engine/export-metadata";
import { stripBOM } from "../engine/source-loader";
import { useToastStore } from "../stores/toast-store";

/**
 * Parse an uploaded export exactly the way the worker does: strip the UTF-8
 * BOM real scraper exports ship with, then JSON.parse. Still throws on
 * genuinely malformed JSON, which the caller surfaces to the user.
 *
 * Exported so the upload page can parse each file ONCE and feed the parsed
 * value to both the file-order assessment and profile detection. If parsing
 * ever moves off the main thread, detection moves with it.
 */
export function parseExport(text: string): unknown {
  return JSON.parse(stripBOM(text).content) as unknown;
}

export function assessFileOrderFromJson(
  baselineText: string,
  latestText: string,
  baselineFileName: string,
  latestFileName: string,
  collectionPath = "Export"
): FileOrderAssessment {
  return assessFileOrder(
    parseExport(baselineText),
    parseExport(latestText),
    baselineFileName,
    latestFileName,
    collectionPath
  );
}

export function notifyReversedFileOrder(assessment: FileOrderAssessment) {
  if (assessment.status !== "reversed") return;
  useToastStore.getState().showToast(BASELINE_DATE_NEWER_TOAST_MESSAGE, "warning");
}
