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
      now={() => FIXED_NOW}
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
      timestamp: FIXED_NOW,
      sequence: 0
    };
    renderQueue([entry]);

    const log = screen.getByTestId("decision-log").textContent ?? "";
    expect(log).toContain("1 entries");
    expect(log).toContain("confirmed");
    expect(log).toContain("Append-only");
  });
});

describe("DecisionQueue: bulk", () => {
  it("states the scope before anything is recorded", () => {
    renderQueue();
    expect(screen.getByTestId("bulk-panel").textContent).toContain("Apply to all 1992 cell(s) in the queue");
  });

  it("narrows the scope with the field filter", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    expect(screen.getByTestId("bulk-panel").textContent).toContain("Apply to all 499 cell(s) for DueDate");
  });

  it("requires confirmation naming the exact count before recording", async () => {
    const user = userEvent.setup();
    const onRecord = renderQueue();

    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    await user.type(screen.getByTestId("bulk-reason"), "confirmed in writing");
    await user.click(screen.getByTestId("bulk-backfill"));

    // Nothing recorded yet: this is a confirmation, not a one-click override.
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-confirm").textContent).toContain("Record 499 decision(s)");
  });

  it("records the batch once confirmed", async () => {
    const user = userEvent.setup();
    const onRecord = renderQueue();

    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    await user.type(screen.getByTestId("bulk-reason"), "confirmed in writing");
    await user.click(screen.getByTestId("bulk-backfill"));
    await user.click(screen.getByTestId("bulk-confirm-apply"));

    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next).toHaveLength(499);
    expect(new Set(next.map((entry) => entry.id)).size).toBe(499);
    expect(screen.getByTestId("bulk-outcome").textContent).toContain("Recorded 499 decision(s)");
  });

  it("cancels without recording", async () => {
    const user = userEvent.setup();
    const onRecord = renderQueue();

    await user.type(screen.getByTestId("bulk-reason"), "reason");
    await user.click(screen.getByTestId("bulk-keep"));
    await user.click(screen.getByTestId("bulk-confirm-cancel"));

    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bulk-confirm")).toBeNull();
  });

  it("refuses a bulk decision with no reason and says why", async () => {
    const user = userEvent.setup();
    const onRecord = renderQueue();

    await user.click(screen.getByTestId("bulk-backfill"));
    await user.click(screen.getByTestId("bulk-confirm-apply"));

    expect(screen.getByTestId("bulk-error").textContent).toContain("reason is required");
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("offers no bulk custom value at all", () => {
    renderQueue();
    // Applying one literal everywhere is the modal-value mistake; it stays per-cell.
    expect(screen.queryByTestId("bulk-custom")).toBeNull();
    expect(screen.getByTestId("bulk-panel").textContent).toContain("custom value stays a");
  });
});

describe("DecisionQueue: decision timestamps are the decision's, not the render's", () => {
  // The regression this covers: every entry used to be stamped with the review's
  // generatedAt, so all decisions in a run carried one identical timestamp — false
  // as an audit record, and ambiguous to reorder after a reload.
  it("reads the clock when the decision is recorded, and stamps the log position", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const clock = vi.fn(() => "2026-08-10T04:05:06.000Z");
    render(
      <DecisionQueue
        review={review}
        profile={BELLINGHAM_PROCUREWARE}
        log={[]}
        onRecord={onRecord}
        now={clock}
      />
    );

    // Rendering alone decides nothing, so it consults no clock.
    expect(clock).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    await user.type(screen.getByTestId("bulk-reason"), "confirmed by phone");
    await user.click(screen.getByTestId("bulk-backfill"));
    expect(clock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("bulk-confirm-apply"));

    expect(clock).toHaveBeenCalled();
    const [next] = onRecord.mock.calls[0] as [RecoveryDecision[]];
    expect(next[0]!.timestamp).toBe("2026-08-10T04:05:06.000Z");
    // Positions are the log length each entry is appended at, so a reload can
    // reconstruct append order even though the batch shares one timestamp.
    expect(next.map((entry) => entry.sequence)).toEqual(next.map((_, index) => index));
  });
});

describe("DecisionQueue: the bulk confirm says what will actually happen", () => {
  it("enumerates fills, overwrites, and skipped rule-6 fields for a mixed batch", async () => {
    // A bare count hides that "use reference for all" would overwrite populated
    // values and rubber-stamp date-sensitive fields; the confirm breaks it down.
    const user = userEvent.setup();
    renderQueue();

    await user.type(screen.getByTestId("bulk-reason"), "apply everything");
    await user.click(screen.getByTestId("bulk-backfill"));

    const breakdown = screen.getByTestId("bulk-breakdown").textContent ?? "";
    expect(breakdown).toContain("overwrite a populated candidate value");
    expect(breakdown).toContain("date-sensitive (rule 6):");
    expect(breakdown).toContain("DueDate (499)");
    expect(breakdown).toContain("BidStatus (499)");
    expect(breakdown).toContain("SKIPPED; filter to a single field");
  });

  it("marks a single-field date-sensitive batch as scoped rather than skipped", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.selectOptions(screen.getByTestId("decision-field-filter"), "DueDate");
    await user.type(screen.getByTestId("bulk-reason"), "confirmed in writing");
    await user.click(screen.getByTestId("bulk-backfill"));

    const breakdown = screen.getByTestId("bulk-breakdown").textContent ?? "";
    expect(breakdown).toContain("DueDate (499)");
    expect(breakdown).toContain("every cell in this batch is this one field");
    expect(breakdown).not.toContain("SKIPPED");
  });

  it("shows no breakdown for keep_candidate, which changes nothing", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.type(screen.getByTestId("bulk-reason"), "leave everything");
    await user.click(screen.getByTestId("bulk-keep"));

    expect(screen.getByTestId("bulk-confirm")).toBeTruthy();
    expect(screen.queryByTestId("bulk-breakdown")).toBeNull();
  });

  it("reports the rule-6 skips in the outcome after a mixed bulk backfill", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.type(screen.getByTestId("bulk-reason"), "apply everything");
    await user.click(screen.getByTestId("bulk-backfill"));
    await user.click(screen.getByTestId("bulk-confirm-apply"));

    const outcome = screen.getByTestId("bulk-outcome").textContent ?? "";
    expect(outcome).toMatch(/Recorded \d+ decision\(s\)\. Skipped 1984:/);
    expect(outcome).toContain("date-sensitive (rule 6)");
  });
});
