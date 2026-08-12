import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/**
 * The field-first explorer, driven with the real Bellingham pair. The numbers
 * asserted are the engine's own (see the unit suites); a mismatch here means
 * the UI shows something the engine did not produce.
 */
test.describe("explore tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Explore", exact: true }).click();
    await expect(page.getByTestId("fields-explorer")).toBeVisible({ timeout: 30000 });
  });

  test("shows the §6.3 evidence: ContactPhone's volatility is unmeasurable", async ({ page }) => {
    await page.getByTestId("field-row-ContactPhone").click();

    const evidence = page.getByTestId("field-evidence");
    await expect(evidence).toContainText("171");
    await expect(page.getByTestId("volatility-unmeasurable")).toContainText(
      "volatility unmeasurable from this run pair"
    );
  });

  test("groups ContactEmail's reference values with the singleton visible", async ({ page }) => {
    await page.getByTestId("field-row-ContactEmail").click();

    await expect(page.getByTestId("value-group-bids@cob.org")).toContainText("238");
    await expect(page.getByTestId("value-group-BIDS@COB.ORG")).toBeVisible();
    await expect(page.getByTestId("value-group-purchasing@cob.org")).toBeVisible();
    await expect(page.getByTestId("value-group-caveat")).toContainText("each record's own reference value");

    // A value-group click filters the table, and the bulk scope names the group.
    await page.getByTestId("value-group-purchasing@cob.org").click();
    await expect(page.getByTestId("field-cells-count")).toContainText("Showing 1 of");
    await expect(page.getByTestId("bulk-scope")).toContainText("purchasing@cob.org");
  });

  test("virtualizes the record table rather than rendering all 501 rows", async ({ page }) => {
    await page.getByTestId("field-row-DueDate").click();
    await expect(page.getByTestId("field-cells")).toBeVisible();

    const rendered = await page.locator('[data-testid^="field-cell-"]').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
  });

  test("a bulk decision on DueDate reaches the Recovery tab's log and the exported audit", async ({ page }) => {
    await page.getByTestId("field-row-DueDate").click();
    await expect(page.getByTestId("bulk-scope")).toContainText("499");

    await page.getByTestId("bulk-reason").fill("deadline list confirmed in writing");
    await page.getByTestId("bulk-backfill").click();
    // The confirmation names the count and rule 6 before anything is recorded.
    await expect(page.getByTestId("bulk-confirm")).toContainText("499");
    await expect(page.getByTestId("bulk-breakdown")).toContainText("rule-6 date-sensitive");
    await page.getByTestId("bulk-confirm-apply").click();
    await expect(page.getByTestId("bulk-outcome")).toContainText("Recorded 499 decision(s).");

    // The same log, on the other tab.
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("recovery-review")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("decision-log")).toContainText("499 entries");

    // And in the exported artifact: the audit carries the decisions' reasons.
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovery-audit").click();
    const download = await downloadPromise;
    const audit = fs.readFileSync(await download.path(), "utf8");
    expect(audit).toContain("deadline list confirmed in writing");
    expect(audit).toContain("manual_override");
  });

  test("vetoing an auto backfill marks the cell vetoed and survives a reload", async ({ page }) => {
    await page.getByTestId("field-row-Title").click();

    // 1B-2020 sorts into the first virtualized window; rows further down are
    // not rendered until scrolled to.
    const row = page.getByTestId("field-cell-1B-2020");
    await row.getByTestId("decide-1B-2020").click();
    await row.getByTestId("decision-reason").fill("title was renamed upstream");
    await row.getByTestId("decision-veto").click();
    await expect(row.getByTestId("cell-decided")).toHaveText("vetoed");

    // Decisions persist in IndexedDB; a reload must not lose the veto.
    await page.reload();
    await expect(page.getByTestId("fields-explorer")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("field-row-Title").click();
    await expect(page.getByTestId("field-cell-1B-2020").getByTestId("cell-decided")).toHaveText("vetoed", {
      timeout: 15000
    });
  });

  test("deep links from Field Changes and Data Health land on the field", async ({ page }) => {
    // BidStatus sorts into the field-changes table's first virtualized window.
    await page.getByRole("link", { name: "Field Changes", exact: true }).click();
    await page.getByTestId("field-change-row-BidStatus").click();
    await expect(page.getByTestId("fields-explorer")).toBeVisible();
    await expect(page.getByTestId("field-evidence")).toContainText("499");

    await page.getByRole("link", { name: "Data Health", exact: true }).click();
    await page.getByTestId("issue-field-link-DueDate").first().click();
    await expect(page.getByTestId("fields-explorer")).toBeVisible();
    await expect(page.getByTestId("field-detail")).toContainText("DueDate");
  });
});

test.describe("explore tab: by record", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    await page.getByTestId("analyze-button").click();
    await page.getByRole("link", { name: "Explore", exact: true }).click();
    await expect(page.getByTestId("fields-explorer")).toBeVisible({ timeout: 30000 });
    await page.getByTestId("mode-record").click();
    await expect(page.getByTestId("record-queue")).toBeVisible();
  });

  test("accepts a record's values behind the rule-6 acknowledgment, and the log and audit carry them", async ({
    page
  }) => {
    await page.getByTestId("queue-record-1B-2020").click();
    await expect(page.getByTestId("record-mode-panel")).toContainText("1B-2020");
    // The output column shows the record as it will export: Title already
    // auto-backfilled, DueDate still the blank candidate.
    await expect(page.getByTestId("record-output-Title")).toContainText("reference backfill");
    await expect(page.getByTestId("record-output-DueDate")).toContainText("candidate");

    await page.getByTestId("record-bulk-reason").fill("verified against the agency portal, Aug 2026");
    await page.getByTestId("record-accept-all").click();
    // The confirmation names rule 6 and its fields; apply is gated on the checkbox.
    await expect(page.getByTestId("rule6-acknowledgment")).toContainText("rule-6 date-sensitive");
    await expect(page.getByTestId("record-bulk-apply")).toBeDisabled();
    await page.getByTestId("rule6-acknowledge-check").check();
    await page.getByTestId("record-bulk-apply").click();
    await expect(page.getByTestId("record-bulk-outcome")).toContainText("Recorded 4 decision(s)");

    // The record resolves in the queue and the output column flips.
    await expect(page.getByTestId("queue-record-1B-2020").getByTestId("queue-resolved")).toBeVisible();
    await expect(page.getByTestId("record-output-DueDate")).toContainText("your decision");

    // Same log on the Recovery tab, and the audit artifact carries the reason.
    await page.getByRole("link", { name: "Recovery", exact: true }).click();
    await expect(page.getByTestId("recovery-review")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("decision-log")).toContainText("4 entries");

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("download-recovery-audit").click();
    const audit = fs.readFileSync(await (await downloadPromise).path(), "utf8");
    expect(audit).toContain("verified against the agency portal, Aug 2026");
  });

  test("edits one field to a corrected value, pre-filled from the reference", async ({ page }) => {
    await page.getByTestId("queue-record-1B-2020").click();
    const row = page.getByTestId("record-cell-DueDate");
    const reference = (await row.locator("td").nth(2).textContent())?.trim() ?? "";

    await row.getByTestId("decide-1B-2020").click();
    // The custom box starts as the reference value — correct it, don't retype it.
    await expect(row.getByTestId("decision-custom")).toHaveValue(reference);
    await row.getByTestId("decision-reason").fill("description shows the deadline moved");
    await row.getByTestId("decision-custom").fill("8/4/2026 11:00 AM");
    await row.getByTestId("decision-custom-apply").click();

    await expect(row.getByTestId("cell-decided")).toContainText("custom value");
    await expect(page.getByTestId("record-output-DueDate")).toContainText("8/4/2026 11:00 AM");
  });

  test("walks the queue with the keyboard and next-pending skips resolved records", async ({ page }) => {
    await page.getByTestId("queue-record-1B-2020").click();
    await expect(page.getByTestId("record-position")).toContainText("4 pending");

    await page.keyboard.press("j");
    const afterJ = (await page.getByTestId("record-position").textContent()) ?? "";
    await page.keyboard.press("k");
    const afterK = (await page.getByTestId("record-position").textContent()) ?? "";
    expect(afterJ).not.toBe(afterK);

    await page.keyboard.press("n");
    await expect(page.getByTestId("record-position")).toContainText("pending");
  });
});
