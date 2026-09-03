/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OverviewPage } from "./OverviewPage";
import { runAnalysis } from "../../engine/diff";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { useUiStore } from "../../stores/ui-store";

vi.mock("../../db", () => ({ getProfileOverride: async () => null }));

const analysis = runAnalysis({
  baselineData: baseline,
  latestData: latest,
  baselineFileName: "baseline.json",
  latestFileName: "latest.json",
  analysisKey: "fixture-key",
  config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: "default-government-bids" }
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ analysis: null });
});

function renderPage() {
  useUiStore.setState({ analysis });
  return render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>
  );
}

describe("OverviewPage", () => {
  it("asks for an analysis when none exists", () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(screen.getByText("Run an analysis first.")).toBeTruthy();
  });

  it("renders every tile as a link, so filtered views can open in a new tab", () => {
    renderPage();
    const expected: Array<[string, string]> = [
      ["tile-quality-gate", "/results?tab=recovery"],
      ["tile-added", "/results?tab=records&status=added"],
      ["tile-removed", "/results?tab=records&status=removed"],
      ["tile-changed", "/results?tab=records&status=changed"]
    ];
    for (const [testid, href] of expected) {
      const tile = screen.getByTestId(testid);
      expect(tile.tagName).toBe("A");
      expect(tile.getAttribute("href")).toBe(href);
    }
  });

  it("shows the summary counts and the gate verdict on the tiles", () => {
    renderPage();
    expect(screen.getByTestId("tile-quality-gate").textContent).toContain(analysis.summary.qualityGate);
    expect(screen.getByTestId("tile-added").textContent).toContain(String(analysis.summary.addedCount));
    expect(screen.getByTestId("tile-removed").textContent).toContain(String(analysis.summary.removedCount));
    expect(screen.getByTestId("tile-changed").textContent).toContain(String(analysis.summary.changedCount));
  });

  it("renders the narrative and the worst population regressions", () => {
    renderPage();
    expect(screen.getByText(analysis.narrative).textContent).toBe(analysis.narrative);
    const worst = [...analysis.fieldStats].sort((a, b) => a.populationChange - b.populationChange)[0]!;
    expect(screen.getByText(new RegExp(`^${worst.field}:`)).textContent).toContain(worst.field);
  });
});

describe("OverviewPage: the alert that put the run on hold", () => {
  const shared = (title: string, index: number) => ({
    AgentID: "1431",
    ProjectCode: `${index}B-2026`,
    BidURL: `https://cob.procureware.com/Bids/${index}`,
    Title: title,
    BidType: "RFP"
  });

  function renderWithReview(reference: Array<Record<string, unknown>>, candidate: Array<Record<string, unknown>>) {
    useUiStore.setState({
      analysis,
      review: runRecoveryReview(reference, candidate, BELLINGHAM_PROCUREWARE, {
        generatedAt: "2026-09-03T00:00:00.000Z",
        sourceRun: "candidate.json",
        referenceRun: "reference.json"
      })
    });
    return render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
  }

  it("shows no triage panel for a run with no recovery review", () => {
    renderPage();
    expect(screen.queryByTestId("alert-triage")).toBeNull();
  });

  it("calls a group the reference run also had recurring, not new", async () => {
    const records = [0, 1, 2].map((index) => shared("Aluminum Sulfate (Liquid)", index));
    renderWithReview(records, records);
    const panel = await screen.findByTestId("alert-triage");
    expect(panel.getAttribute("data-outcome")).toBe("recurring");
    expect(screen.getByTestId("triage-headline").textContent).toContain("Nothing new in this run");
    // Overview states the verdict; the groups themselves live on Data Health.
    expect(screen.queryByTestId("triage-group-0")).toBeNull();
    expect(screen.getByTestId("triage-details-link").getAttribute("href")).toBe("/results?tab=data-health");
  });

  it("flags a group this run introduced", async () => {
    const reference = [0, 1, 2].map((index) => shared(`Distinct ${index}`, index));
    const candidate = [0, 1, 2].map((index) => shared("Snow Removal Services", index));
    renderWithReview(reference, candidate);
    const panel = await screen.findByTestId("alert-triage");
    expect(panel.getAttribute("data-outcome")).toBe("new");
    expect(screen.getByTestId("triage-headline").textContent).toContain("1 new in this run");
  });

  it("says a clean run was checked, naming the threshold", async () => {
    const records = [0, 1, 2].map((index) => shared(`Distinct ${index}`, index));
    renderWithReview(records, records);
    const panel = await screen.findByTestId("alert-triage");
    expect(panel.getAttribute("data-outcome")).toBe("clear");
    expect(screen.getByTestId("triage-headline").textContent).toContain("3 or more records");
  });
});
