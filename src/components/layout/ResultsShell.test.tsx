/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ResultsShell } from "./ResultsShell";
import { runAnalysis } from "../../engine/diff";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { useUiStore } from "../../stores/ui-store";

// The shell restores from IndexedDB when the store is empty; these tests seed
// the store directly, so the cache must simply stay quiet.
vi.mock("../../db", () => ({
  db: { analyses: { get: async () => undefined, orderBy: () => ({ reverse: () => ({ first: async () => undefined } ) }) } }
}));

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

function renderShell(query: string) {
  useUiStore.setState({ analysis });
  return render(
    <MemoryRouter initialEntries={[`/results${query}`]}>
      <Routes>
        <Route path="/results" element={<ResultsShell />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ResultsShell tab handling", () => {
  it("renders the requested tab when it exists", () => {
    renderShell("?tab=data-health");
    expect(screen.getByRole("heading", { name: "Data Health" })).toBeTruthy();
  });

  it("falls back to the overview for an unknown ?tab= instead of an empty shell", () => {
    renderShell("?tab=does-not-exist");
    expect(screen.getByText("Deterministic incident narrative")).toBeTruthy();
  });
});
