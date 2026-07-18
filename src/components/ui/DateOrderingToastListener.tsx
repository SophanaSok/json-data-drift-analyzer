import { useEffect, useRef } from "react";
import { notifyReversedFileOrder } from "../../lib/file-order";
import { useUiStore } from "../../stores/ui-store";

export function DateOrderingToastListener() {
  const assessment = useUiStore((state) => state.fileOrderAssessment);
  const lastNotification = useRef<string | null>(null);

  useEffect(() => {
    if (!assessment || assessment.status !== "reversed") {
      lastNotification.current = null;
      return;
    }

    const fingerprint = JSON.stringify([
      assessment.baselineFileName,
      assessment.latestFileName,
      assessment.issues
    ]);
    if (lastNotification.current === fingerprint) return;

    lastNotification.current = fingerprint;
    notifyReversedFileOrder(assessment);
  }, [assessment]);

  return null;
}
