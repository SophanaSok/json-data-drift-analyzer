/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindingsExplorer } from "./FindingsExplorer";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: "2026-08-10T00:00:00.000Z"
});
const findings = review.qa.findings;

// Vitest is configured without globals, so RTL's automatic cleanup does not run.
afterEach(cleanup);

const count = () => screen.getByTestId("findings-count").textContent ?? "";

describe("FindingsExplorer: filter controls", () => {
  it("offers only the severities present in this run", () => {
    render(<FindingsExplorer findings={findings} />);
    const options = [...screen.getByTestId("filter-severity").querySelectorAll("option")].map(
      (option) => option.textContent
    );

    expect(options).toContain("high");
    expect(options).toContain("medium");
    // Nothing critical in this run, so nothing should invite the user to select it.
    expect(options).not.toContain("critical");
  });

  it("lists the affected fields and the actions actually recommended", () => {
    render(<FindingsExplorer findings={findings} />);
    const fields = [...screen.getByTestId("filter-field").querySelectorAll("option")].map((o) => o.textContent);
    const actions = [...screen.getByTestId("filter-action").querySelectorAll("option")].map((o) => o.textContent);

    expect(fields).toContain("Title");
    expect(actions).toContain("backfill allowed");
    expect(actions).toContain("manual review");
  });

  it("starts unfiltered and shows the full count", () => {
    render(<FindingsExplorer findings={findings} />);
    expect(count()).toBe("Showing 3399 of 3399");
  });
});

describe("FindingsExplorer: filtering", () => {
  it("narrows to a single field", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    await user.selectOptions(screen.getByTestId("filter-field"), "Title");
    expect(count()).toBe("Showing 499 of 3399");
  });

  it("narrows by category", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    await user.selectOptions(screen.getByTestId("filter-category"), "field_conflict");
    expect(count()).toBe("Showing 5 of 3399");
  });

  it("combines filters as AND, down to nothing when they contradict", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    await user.selectOptions(screen.getByTestId("filter-field"), "Title");
    await user.selectOptions(screen.getByTestId("filter-category"), "field_conflict");

    expect(count()).toBe("Showing 0 of 3399");
    expect(screen.getByTestId("findings-empty").textContent).toContain("No findings match");
  });

  it("searches free text", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    await user.type(screen.getByTestId("filter-search"), "DueDate");
    expect(count()).not.toBe("Showing 3399 of 3399");
    expect(count()).not.toBe("Showing 0 of 3399");
  });
});

describe("FindingsExplorer: reset", () => {
  it("offers reset only once a filter is active", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    expect(screen.queryByTestId("filter-reset")).toBeNull();

    await user.selectOptions(screen.getByTestId("filter-field"), "Title");
    expect(screen.getByTestId("filter-reset")).not.toBeNull();
  });

  it("restores the full set", async () => {
    const user = userEvent.setup();
    render(<FindingsExplorer findings={findings} />);

    await user.selectOptions(screen.getByTestId("filter-field"), "Title");
    await user.click(screen.getByTestId("filter-reset"));

    expect(count()).toBe("Showing 3399 of 3399");
    expect(screen.queryByTestId("filter-reset")).toBeNull();
  });
});

describe("FindingsExplorer: empty input", () => {
  it("says so rather than rendering an empty frame", () => {
    render(<FindingsExplorer findings={[]} />);

    expect(count()).toBe("Showing 0 of 0");
    expect(screen.getByTestId("findings-empty")).not.toBeNull();
  });
});
