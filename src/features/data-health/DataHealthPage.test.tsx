/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DataHealthPage } from "./DataHealthPage";
import { runAnalysis } from "../../engine/diff";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import { useUiStore } from "../../stores/ui-store";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";

vi.mock("../../db", () => ({ getProfileOverride: async () => null }));

const analysis = runAnalysis({
  baselineData: baseline,
  latestData: latest,
  baselineFileName: "baseline.json",
  latestFileName: "latest.json",
  analysisKey: "fixture-key",
  config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: "default-government-bids" }
});

// Three records sharing one Title, present in both runs: the recurring-solicitation
// shape that makes most duplicate-title alerts a false positive.
const recurring = ["a", "b", "c"].map((suffix, index) => ({
  AgentID: "1431",
  ProjectCode: `${index}B-2026`,
  BidURL: `https://cob.procureware.com/Bids/${suffix}`,
  Title: "Aluminum Sulfate (Liquid)",
  BidType: "RFP"
}));

const review = runRecoveryReview(recurring, recurring, BELLINGHAM_PROCUREWARE, {
  generatedAt: "2026-09-03T00:00:00.000Z",
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

afterEach(() => {
  cleanup();
  useUiStore.setState({ analysis: null, review: null });
});

function renderPage(withReview = true) {
  useUiStore.setState({ analysis, review: withReview ? review : null });
  return render(
    <MemoryRouter>
      <DataHealthPage />
    </MemoryRouter>
  );
}

describe("DataHealthPage", () => {
  it("says what to do when no run is loaded", () => {
    render(
      <MemoryRouter>
        <DataHealthPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Load a reference and a candidate export/)).toBeTruthy();
  });

  it("leads with the duplicate-title verdict and lists the groups", async () => {
    renderPage();
    const panel = await screen.findByTestId("alert-triage");
    expect(panel.getAttribute("data-outcome")).toBe("recurring");
    expect(screen.getByTestId("triage-headline").textContent).toContain("Nothing new in this run");
    const row = screen.getByTestId("triage-group-0");
    expect(row.textContent).toContain("Aluminum Sulfate (Liquid)");
    expect(row.textContent).toContain("also in reference");
  });

  it("copies a triage note naming both runs", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      renderPage();
      await userEvent.click(await screen.findByTestId("triage-copy"));
      expect(writeText).toHaveBeenCalledTimes(1);
      const note = writeText.mock.calls[0]?.[0] as string;
      expect(note).toContain("Candidate run: candidate.json");
      expect(note).toContain("Reference run: reference.json");
      expect(note).toContain("no hold was released by this tool");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("groups health items by severity and counts them", () => {
    renderPage();
    expect(screen.getByTestId("health-sections")).toBeTruthy();
    const count = screen.getByTestId("health-count").textContent ?? "";
    expect(count).toMatch(/Showing \d+ of \d+/);
    // The wiped fixture pair raises at least one critical drift issue.
    expect(screen.getByTestId("health-section-critical")).toBeTruthy();
  });

  it("filters by severity and says when nothing matches", async () => {
    renderPage();
    const before = screen.getByTestId("health-count").textContent;
    await userEvent.selectOptions(screen.getByTestId("health-filter-severity"), "low");
    expect(screen.getByTestId("health-count").textContent).not.toBe(before);
    expect(screen.queryByTestId("health-no-matches")).toBeTruthy();
    await userEvent.click(screen.getByTestId("health-filter-clear"));
    expect(screen.getByTestId("health-count").textContent).toBe(before);
  });

  it("searches across titles, details, and field names", async () => {
    renderPage();
    await userEvent.type(screen.getByTestId("health-filter-search"), "zzzz-no-such-thing");
    expect(screen.getByTestId("health-no-matches")).toBeTruthy();
  });

  it("deep-links each field to Explore", () => {
    renderPage();
    const link = screen.getAllByTestId(/^issue-field-link-/)[0];
    expect(link?.getAttribute("href")).toContain("tab=explore&field=");
  });

  it("shows ingestion-share proxies, labelled as proxies rather than an answer", async () => {
    renderPage();
    const panel = await screen.findByTestId("ingestion-proxies");
    expect(panel.textContent).toContain("none of these numbers measures that alert");
    expect(panel.textContent).toContain("no threshold is applied");
    // Driven by the profile's own fields: Description (corroboration text),
    // BidStatus and BidType (search roles), and the configured JSON fields.
    expect(screen.getByTestId("proxy-proxy:Description:empty")).toBeTruthy();
    expect(screen.getByTestId("proxy-proxy:BidDocuments:json")).toBeTruthy();
    expect(screen.getByTestId("proxies-scope").textContent).toContain("2 reference records");
  });

  it("says there is nothing to compare when no profile governs the run", () => {
    renderPage(false);
    expect(screen.getByTestId("proxies-unconfigured")).toBeTruthy();
  });

  it("says QA findings are missing when the run has no review", () => {
    renderPage(false);
    expect(screen.getByTestId("health-no-review")).toBeTruthy();
    expect(screen.queryByTestId("alert-triage")).toBeNull();
  });
});
