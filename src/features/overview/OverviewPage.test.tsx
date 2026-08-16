/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OverviewPage } from "./OverviewPage";
import { runAnalysis } from "../../engine/diff";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { useUiStore } from "../../stores/ui-store";

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
