import { describe, expect, it } from "vitest";
import { findDateOrderingIssuesFromJson, notifyDateOrderingIssues } from "./date-ordering-toast";
import { useToastStore } from "../stores/toast-store";

describe("date ordering toast", () => {
  it("finds ordering issues from uploaded JSON text", () => {
    const baseline = JSON.stringify({ Created: "2024-03-01T08:00:00Z", Export: [] });
    const latest = JSON.stringify({ Created: "2024-01-20T08:00:00Z", Export: [] });

    expect(findDateOrderingIssuesFromJson(baseline, latest)).toEqual([
      { field: "Created", baseline: "2024-03-01T08:00:00Z", latest: "2024-01-20T08:00:00Z" }
    ]);
  });

  it("queues a warning toast when issues are present", () => {
    useToastStore.setState({ toasts: [] });
    notifyDateOrderingIssues([{ field: "Refreshed", baseline: "2024-03-01", latest: "2024-02-01" }]);

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.variant).toBe("warning");
  });
});
