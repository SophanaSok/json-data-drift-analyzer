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

  test("shows what recovery would do, and says it changes nothing", async ({ page }) => {
    await expect(page.getByTestId("recovery-review")).toContainText("What recovery would do");
    await expect(page.getByTestId("recovery-review")).toContainText("this view is read-only");
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
