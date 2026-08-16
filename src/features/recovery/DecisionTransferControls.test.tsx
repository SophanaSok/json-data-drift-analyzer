/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionTransferControls } from "./DecisionTransferControls";
import { buildDecisionTransfer } from "../../engine/decisions-transfer";
import { createDecision, type RecoveryDecision } from "../../engine/decisions";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { resolveEffectiveProfile } from "../../profiles/resolve";

// jsdom does not implement Blob.text(); real browsers (and the e2e-covered
// override import that uses the same pattern) do.
if (typeof File.prototype.text !== "function") {
  File.prototype.text = function text(this: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

const FIXED_NOW = "2026-08-10T00:00:00.000Z";
const profile = resolveEffectiveProfile(BELLINGHAM_PROCUREWARE, null).profile;

const reference = [
  { AgentID: "1431", ProjectCode: "10B-2026", BidURL: "https://cob.procureware.com/Bids/aaa", Title: "Water Main", DueDate: "7/29/2026" }
];
const candidate = [
  { AgentID: "1431", ProjectCode: "10B-2026", BidURL: "https://cob.procureware.com/Bids/aaa", Title: "", DueDate: "" }
];

const review = runRecoveryReview(reference, candidate, profile, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json",
  inputHashes: [
    { fileName: "candidate.json", role: "candidate", sha256: "c".repeat(64), unavailableReason: null },
    { fileName: "reference.json", role: "reference", sha256: "r".repeat(64), unavailableReason: null }
  ]
});

function decision(sequence: number, field = "Title"): RecoveryDecision {
  return createDecision(
    { recordKey: "10B-2026", field, action: "backfill", reason: `imported ${sequence}` },
    {
      recordKey: "10B-2026",
      field,
      lane: "review",
      reason: "test",
      candidateValue: "",
      referenceValue: "Water Main",
      candidateIsBlank: true,
      profilePermitsField: false
    },
    { review, profile, timestamp: FIXED_NOW, sequence }
  );
}

function importFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], "decisions.json", { type: "application/json" });
}

afterEach(cleanup);

describe("DecisionTransferControls", () => {
  it("disables export while the log is empty", () => {
    render(<DecisionTransferControls review={review} log={[]} onRecord={vi.fn()} />);
    expect((screen.getByTestId("export-decisions") as HTMLButtonElement).disabled).toBe(true);
  });

  it("imports a matching transfer and appends after the local log", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const local = [decision(0, "Title")];
    const transfer = buildDecisionTransfer(review, [decision(0, "DueDate")], FIXED_NOW);

    render(<DecisionTransferControls review={review} log={local} onRecord={onRecord} />);
    await user.upload(screen.getByTestId("decision-import-input"), importFile(transfer));

    await waitFor(() => expect(onRecord).toHaveBeenCalledTimes(1));
    const next = onRecord.mock.calls[0]![0] as RecoveryDecision[];
    expect(next).toHaveLength(2);
    expect(next[1]!.field).toBe("DueDate");
    expect(next[1]!.sequence).toBe(1);
    expect(screen.queryByTestId("decision-import-problems")).toBeNull();
  });

  it("refuses a transfer from a different policy, naming the mismatch", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const transfer = buildDecisionTransfer(review, [decision(0)], FIXED_NOW);
    transfer.context.policyHash = "someone-elses-policy";

    render(<DecisionTransferControls review={review} log={[]} onRecord={onRecord} />);
    await user.upload(screen.getByTestId("decision-import-input"), importFile(transfer));

    const problems = await screen.findByTestId("decision-import-problems");
    expect(problems.textContent).toContain("Policy mismatch");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("rejects a file that is not valid JSON", async () => {
    const user = userEvent.setup();
    render(<DecisionTransferControls review={review} log={[]} onRecord={vi.fn()} />);
    await user.upload(
      screen.getByTestId("decision-import-input"),
      new File(["{ broken"], "broken.json", { type: "application/json" })
    );
    const problems = await screen.findByTestId("decision-import-problems");
    expect(problems.textContent).toContain("not valid JSON");
  });
});
