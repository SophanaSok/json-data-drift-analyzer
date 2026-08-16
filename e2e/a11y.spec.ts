import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const root = process.cwd();

/**
 * Automated axe scan of every main screen.
 *
 * The bar: zero violations at critical or serious impact. Moderate/minor
 * findings are reported humans' territory — failing the build on them would
 * push toward suppressions instead of fixes.
 */
async function expectNoSeriousViolations(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" "))
    })),
    `axe violations on ${screen}`
  ).toEqual([]);
}

async function analyzeFixturePair(page: Page) {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
  await page.getByTestId("latest-input").setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
  await page.getByTestId("analyze-button").click();
  await expect(page.getByText("Deterministic incident narrative")).toBeVisible({ timeout: 30000 });
}

test("upload page, empty and with files loaded", async ({ page }) => {
  await page.goto("");
  await expectNoSeriousViolations(page, "upload (empty)");
  await page.getByTestId("baseline-input").setInputFiles(path.join(root, "src/test/fixtures/baseline.json"));
  await page.getByTestId("latest-input").setInputFiles(path.join(root, "src/test/fixtures/latest.json"));
  await expect(page.getByTestId("export-date-panel").or(page.getByText("EXPORT DATES"))).toBeVisible();
  await expectNoSeriousViolations(page, "upload (files loaded)");
});

test("overview, records, and field changes", async ({ page }) => {
  await analyzeFixturePair(page);
  await expectNoSeriousViolations(page, "overview");
  await page.goto("results?tab=records");
  await expect(page.getByText(/Showing \d+ of/)).toBeVisible();
  await expectNoSeriousViolations(page, "records");
  await page.goto("results?tab=field-changes");
  await expect(page.getByTestId("sort-change")).toBeVisible();
  await expectNoSeriousViolations(page, "field changes");
});

test("explore in both modes", async ({ page }) => {
  await analyzeFixturePair(page);
  await page.goto("results?tab=explore&field=DueDate");
  await expect(page.getByText("By record")).toBeVisible();
  await expectNoSeriousViolations(page, "explore (by field)");
  await page.goto("results?tab=explore&field=DueDate&mode=record&record=1B-2019");
  await expect(page.getByText(/record \d+ of \d+/)).toBeVisible();
  await expectNoSeriousViolations(page, "explore (by record)");
});

test("recovery, ticket, and profiles", async ({ page }) => {
  await analyzeFixturePair(page);
  await page.goto("results?tab=recovery");
  await expect(page.getByTestId("export-state")).toBeVisible();
  await expectNoSeriousViolations(page, "recovery");
  await page.goto("results?tab=ticket");
  await expect(page.getByText("Contractor ticket")).toBeVisible();
  await expectNoSeriousViolations(page, "ticket");
  await page.goto("profiles?id=bellingham-procureware");
  await expect(page.getByTestId("profile-detail")).toBeVisible();
  await expectNoSeriousViolations(page, "profiles");
});
