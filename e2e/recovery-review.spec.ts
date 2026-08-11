import { expect, test } from "@playwright/test";
import path from "node:path";

const root = process.cwd();

/**
 * Drives the real Bellingham exports through the whole pipeline in a browser.
 *
 * The numbers asserted here are the same ones the engine unit tests assert, so a
 * mismatch means the UI is showing something the engine did not produce.
 */
test.describe("recovery review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("recovery-review")).toBeVisible({ timeout: 30000 });
  });

  test("shows what recovery would do, and says decisions reach the exports", async ({ page }) => {
    await expect(page.getByTestId("recovery-review")).toContainText("What recovery would do");
    await expect(page.getByTestId("recovery-review")).toContainText("applied to the exported artifacts");
    await expect(page.getByTestId("recovery-review")).toContainText("bellingham-procureware");
  });

  test("reports the per-field backfill counts the engine produced", async ({ page }) => {
    await expect(page.getByTestId("backfill-Title")).toContainText("499");
    await expect(page.getByTestId("backfill-BidType")).toContainText("495");
    await expect(page.getByTestId("backfill-ContactEmail")).toContainText("242");
    await expect(page.getByTestId("backfill-ContactPhone")).toContainText("171");
  });

  test("names the fields policy withheld", async ({ page }) => {
    const withheld = page.getByTestId("withheld-fields");
    await expect(withheld).toContainText("DueDate");
    await expect(withheld).toContainText("BidStatus");
    await expect(withheld).toContainText("AwardDate");
    await expect(withheld).toContainText("PublishedDate");
    await expect(withheld).toContainText("ContractValue");
  });

  test("reports the match rate and recovered total", async ({ page }) => {
    const summary = page.getByTestId("review-summary");
    await expect(summary).toContainText("99.80%");
    await expect(summary).toContainText("1407");
  });

  test("drills into a record and shows field-level provenance", async ({ page }) => {
    await page.locator('[data-testid^="record-toggle-"]').first().click();
    await expect(page.getByText("reference_backfill").first()).toBeVisible();
    await expect(page.getByText("(blank)").first()).toBeVisible();
  });

  test("offers every export artifact and blocks none on a clean run", async ({ page }) => {
    await expect(page.getByTestId("download-recovered")).toBeVisible();
    await expect(page.getByTestId("download-quality-report")).toBeVisible();
    await expect(page.getByTestId("download-recovery-audit")).toBeVisible();
    await expect(page.getByTestId("download-findings")).toBeVisible();
    await expect(page.getByTestId("download-contractor-ticket")).toBeVisible();
    await expect(page.getByTestId("export-blocked")).toHaveCount(0);
  });

  test("actually downloads the recovered artifact", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovered").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^bellingham-procureware-recovered-.*\.json$/);
  });
});

test.describe("recovery review: findings explorer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("recovery-review")).toBeVisible({ timeout: 30000 });
  });

  test("states the gate verdict with its scope, and names the systemic loss", async ({ page }) => {
    const state = page.getByTestId("export-state");
    await expect(state).toHaveAttribute("data-state", "safe");
    await expect(state).toContainText("Export permitted");
    // The verdict must not read as "clean data": the residual queue is named…
    await expect(state).toContainText("1992 cell(s) still await manual review");
    // …and the eight-field wipe is a headline, not something to infer from rows.
    const systemic = page.getByTestId("systemic-regression-warning");
    await expect(systemic).toContainText("Title");
    await expect(systemic).toContainText("DueDate");
    await expect(systemic).toContainText("broken extraction routine");
  });

  test("names the recoverable fields", async ({ page }) => {
    await expect(page.getByTestId("recoverable-fields")).toContainText("ContactPhone");
    await expect(page.getByTestId("recoverable-fields")).toContainText("Title");
  });

  test("filters findings by field and by action", async ({ page }) => {
    await expect(page.getByTestId("findings-count")).toContainText("Showing 3408 of 3408");

    await page.getByTestId("filter-field").selectOption("Title");
    await expect(page.getByTestId("findings-count")).toContainText("Showing 500 of 3408");

    await page.getByTestId("filter-reset").click();
    await page.getByTestId("filter-category").selectOption("field_conflict");
    await expect(page.getByTestId("findings-count")).toContainText("Showing 5 of 3408");
  });

  test("reports plainly when a filter combination matches nothing", async ({ page }) => {
    await page.getByTestId("filter-search").fill("no such finding exists");
    await expect(page.getByTestId("findings-empty")).toBeVisible();
  });

  test("virtualizes rather than rendering every finding", async ({ page }) => {
    // 3,399 findings; only a windowful should exist in the DOM.
    const rendered = await page.locator('[data-testid^="finding-row-"]').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(50);
  });

  test("inspects a record with candidate, reference, and output values", async ({ page }) => {
    await page.locator('[data-testid^="record-toggle-"]').first().click();
    const inspector = page.getByTestId("record-inspector");

    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("reference_backfill");
    await expect(inspector).toContainText("candidate");
    await expect(inspector).toContainText("not compared");
  });
});

test("source profile is selectable and governs the review", async ({ page }) => {
  await page.goto("");
  const select = page.getByTestId("source-profile-select");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("bellingham-procureware");
  await expect(page.getByText("Approved fields:")).toContainText("ContactPhone");
});

test.describe("recovery review: decision log", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("decision-queue")).toBeVisible({ timeout: 30000 });
  });

  test("reports the lane split between automatic and awaiting review", async ({ page }) => {
    await expect(page.getByTestId("lane-counts")).toContainText("1407 applied automatically");
    await expect(page.getByTestId("lane-counts")).toContainText("1992 awaiting a decision");
  });

  test("refuses a decision with no reason", async ({ page }) => {
    await page.getByTestId("decide-0").click();
    await page.getByTestId("decision-backfill").click();

    await expect(page.getByTestId("decision-error")).toContainText("reason is required");
    await expect(page.getByTestId("decision-log")).toHaveCount(0);
  });

  test("records a decision and shows it in the append-only log", async ({ page }) => {
    await page.getByTestId("decide-0").click();
    await page.getByTestId("decision-reason").fill("confirmed with the city");
    await page.getByTestId("decision-backfill").click();

    const log = page.getByTestId("decision-log");
    await expect(log).toContainText("1 entries");
    await expect(log).toContainText("confirmed with the city");
    await expect(log).toContainText("Append-only");
    await expect(page.getByTestId("lane-counts")).toContainText("1 decided");

    // The decision is not just logged — the export section confirms it is applied
    // to the recovered artifact.
    await expect(page.getByTestId("decisions-applied")).toContainText("1 recorded decision(s) applied");
  });

  test("keeps the superseded entry when a decision is revised", async ({ page }) => {
    await page.getByTestId("decide-0").click();
    await page.getByTestId("decision-reason").fill("first call");
    await page.getByTestId("decision-backfill").click();

    await page.getByTestId("decide-0").click();
    await page.getByTestId("decision-reason").fill("changed my mind");
    await page.getByTestId("decision-keep").click();

    const log = page.getByTestId("decision-log");
    await expect(log).toContainText("2 entries");
    await expect(log).toContainText("first call");
    await expect(log).toContainText("changed my mind");
    // One cell, decided twice.
    await expect(page.getByTestId("lane-counts")).toContainText("1 decided");
    await expect(page.getByTestId("lane-counts")).toContainText("1 revised");
  });

  test("survives a reload, because decisions are persisted", async ({ page }) => {
    await page.getByTestId("decide-0").click();
    await page.getByTestId("decision-reason").fill("persisted decision");
    await page.getByTestId("decision-backfill").click();
    await expect(page.getByTestId("decision-log")).toContainText("persisted decision");

    // A reload lands back on /results, where the upload inputs do not exist.
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();

    await expect(page.getByTestId("decision-log")).toContainText("persisted decision", { timeout: 30000 });
  });
})

test.describe("recovery review: bulk decisions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("bulk-panel")).toBeVisible({ timeout: 30000 });
  });

  test("requires a confirmation naming the count", async ({ page }) => {
    await page.getByTestId("decision-field-filter").selectOption("DueDate");
    await page.getByTestId("bulk-reason").fill("confirmed with the city");
    await page.getByTestId("bulk-backfill").click();

    await expect(page.getByTestId("bulk-confirm")).toContainText("Record 499 decision(s)");
    // Scoped to one date-sensitive field: allowed, and the breakdown says so.
    await expect(page.getByTestId("bulk-breakdown")).toContainText("DueDate (499)");
    await expect(page.getByTestId("bulk-breakdown")).toContainText("this one field");
    await expect(page.getByTestId("decision-log")).toHaveCount(0);
  });

  test("skips rule-6 fields from an unscoped bulk backfill and says so upfront", async ({ page }) => {
    await page.getByTestId("bulk-reason").fill("apply everything");
    await page.getByTestId("bulk-backfill").click();

    const breakdown = page.getByTestId("bulk-breakdown");
    await expect(breakdown).toContainText("overwrite a populated candidate value");
    await expect(breakdown).toContainText("DueDate (499)");
    await expect(breakdown).toContainText("SKIPPED; filter to a single field");

    await page.getByTestId("bulk-confirm-apply").click();
    await expect(page.getByTestId("bulk-outcome")).toContainText("Skipped 1984");
  });

  test("records the whole batch and persists it", async ({ page }) => {
    await page.getByTestId("decision-field-filter").selectOption("DueDate");
    await page.getByTestId("bulk-reason").fill("confirmed with the city");
    await page.getByTestId("bulk-backfill").click();
    await page.getByTestId("bulk-confirm-apply").click();

    await expect(page.getByTestId("bulk-outcome")).toContainText("Recorded 499 decision(s)");
    await expect(page.getByTestId("decision-log")).toContainText("499 entries");
    await expect(page.getByTestId("lane-counts")).toContainText("499 decided");

    // Every entry must reach storage, not just the last one.
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Recovery", exact: true }).click();

    await expect(page.getByTestId("decision-log")).toContainText("499 entries", { timeout: 30000 });
  });

  test("refuses a bulk decision with no reason", async ({ page }) => {
    await page.getByTestId("bulk-backfill").click();
    await page.getByTestId("bulk-confirm-apply").click();

    await expect(page.getByTestId("bulk-error")).toContainText("reason is required");
    await expect(page.getByTestId("decision-log")).toHaveCount(0);
  });
})
