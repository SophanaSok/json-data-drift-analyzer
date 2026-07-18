import { useEffect } from "react";
import { notifyDateOrderingIssues } from "../../lib/date-ordering-toast";
import { useUiStore } from "../../stores/ui-store";

export function DateOrderingToastListener() {
  const pendingDateOrderingIssues = useUiStore((state) => state.pendingDateOrderingIssues);
  const clearPendingDateOrderingIssues = useUiStore((state) => state.setPendingDateOrderingIssues);

  useEffect(() => {
    if (pendingDateOrderingIssues === null) return;
    notifyDateOrderingIssues(pendingDateOrderingIssues);
    clearPendingDateOrderingIssues(null);
  }, [clearPendingDateOrderingIssues, pendingDateOrderingIssues]);

  return null;
}
