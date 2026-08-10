/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionQueue } from "./DecisionQueue";
import type { RecoveryDecision } from "../../engine/decisions";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

afterEach(cleanup);

function renderQueue(log: RecoveryDecision[] = []) {
  const onRecord = vi.fn();
  render(
    <DecisionQueue
      review={review}
      profile={BELLINGHAM_PROCUREWARE}
      log={log}
      onRecord={onRecord}
      timestamp={FIXED_NOW}
    />
  );
  return onRecord;
}

describe("DecisionQueue: what it shows", () => {
  it("reports the lane split so a reviewer knows the scale", () => {
    renderQueue();
    const counts = screen.getByTestId("lane-counts").textContent ?? "";

    expect(counts).toContain("1407 applied automatically");
    expect(counts).toContain("1992 awaiting a decision");
  });

  it("filters the queue by field", async () => {
    const user = userEvent.setup();
    renderQueue();

    expect(screen.getByTestId("queue-count").textContent).toBe("1992 cell(s)");
    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    expect(screen.getByTestId("queue-count").textContent).toBe("499 cell(s)");
  });

  it("offers only fields that actually need a decision", () => {
    renderQueue();
    const options = [...screen.getByTestId("decision-field-filter").querySelectorAll("option")].map(
      (option) => option.textContent
    );

    expect(options).toContain("DueDate");
    expect(options).toContain("BidStatus");
    // Title was applied automatically, so nothing about it awaits a decision.
    expect(options).not.toContain("Title");
  });
});

describe("DecisionQueue: the log", () => {
  it("is hidden until something has been decided", () => {
    renderQueue();
    expect(screen.queryByTestId("decision-log")).toBeNull();
  });

  it("shows recorded entries and says the log is append-only", () => {
    const entry: RecoveryDecision = {
      id: "decision:1",
      recordKey: "r",
      field: "DueDate",
      action: "backfill",
      originalValue: "",
      outputValue: "8/4/2026",
      actor: "user",
      reason: "confirmed",
      sourceRun: null,
      referenceRun: null,
      matchingKey: [],
      profileId: BELLINGHAM_PROCUREWARE.id,
      profileVersion: 4,
      timestamp: FIXED_NOW
    };
    renderQueue([entry]);

    const log = screen.getByTestId("decision-log").textContent ?? "";
    expect(log).toContain("1 entries");
    expect(log).toContain("confirmed");
    expect(log).toContain("Append-only");
  });
});
