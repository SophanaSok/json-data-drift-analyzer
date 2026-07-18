import { describe, expect, it } from "vitest";
import { assessFileOrderFromJson, notifyReversedFileOrder } from "./file-order";
import { useToastStore } from "../stores/toast-store";

describe("date ordering toast", () => {
  it("finds ordering issues from uploaded JSON text", () => {
    const baseline = JSON.stringify({ Created: "2024-03-01T08:00:00Z", Export: [] });
    const latest = JSON.stringify({ Created: "2024-01-20T08:00:00Z", Export: [] });

    const assessment = assessFileOrderFromJson(
      baseline,
      latest,
      "baseline.json",
      "latest.json"
    );

    expect(assessment.status).toBe("reversed");
    expect(assessment.issues).toEqual([
      { field: "Created", baseline: "2024-03-01T08:00:00Z", latest: "2024-01-20T08:00:00Z" }
    ]);
  });

  it("queues a warning toast when issues are present", () => {
    useToastStore.setState({ toasts: [] });
    const assessment = assessFileOrderFromJson(
      JSON.stringify({ Refreshed: "2024-03-01" }),
      JSON.stringify({ Refreshed: "2024-02-01" }),
      "baseline.json",
      "latest.json"
    );
    notifyReversedFileOrder(assessment);

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.variant).toBe("warning");
  });
});
