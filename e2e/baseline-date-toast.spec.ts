import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fixturesDir = path.join(process.cwd(), "src/test/fixtures");

function writeTempExports(baseline: Record<string, unknown>, latest: Record<string, unknown>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-toast-"));
  const baselinePath = path.join(tempDir, "baseline.json");
  const latestPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  fs.writeFileSync(latestPath, JSON.stringify(latest));
  return { baselinePath, latestPath };
}

async function analyzeWithDateOrderingWarning(page: import("@playwright/test").Page, baselinePath: string, latestPath: string) {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baselinePath);
  await page.getByTestId("latest-input").setInputFiles(latestPath);
  await expect(page.getByTestId("global-file-order-warning")).toBeVisible();
  await expect(page.getByTestId("date-ordering-warning")).toBeVisible();
  await page.getByTestId("analyze-button").click();
  await page.getByRole("button", { name: "Continue anyway" }).click();
}

test("shows toast when baseline Created date is newer than latest", async ({ page }) => {
  const baseline = JSON.parse(fs.readFileSync(path.join(fixturesDir, "baseline.json"), "utf8")) as Record<string, unknown>;
  const latest = JSON.parse(fs.readFileSync(path.join(fixturesDir, "latest.json"), "utf8")) as Record<string, unknown>;

  baseline.Created = "2024-03-01T08:00:00Z";
  latest.Created = "2024-01-20T08:00:00Z";

  const { baselinePath, latestPath } = writeTempExports(baseline, latest);
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baselinePath);
  await page.getByTestId("latest-input").setInputFiles(latestPath);

  await expect(page.getByTestId("global-file-order-warning")).toContainText(
    "Created: baseline 2024-03-01T08:00:00Z is newer than latest 2024-01-20T08:00:00Z"
  );
  await expect(page.getByTestId("toast")).toBeVisible();

  await analyzeWithDateOrderingWarning(page, baselinePath, latestPath);

  await expect(page.getByTestId("global-file-order-warning")).toBeVisible();
});

test("shows toast when only baseline Refreshed date is newer than latest", async ({ page }) => {
  const baseline = JSON.parse(fs.readFileSync(path.join(fixturesDir, "baseline.json"), "utf8")) as Record<string, unknown>;
  const latest = JSON.parse(fs.readFileSync(path.join(fixturesDir, "latest.json"), "utf8")) as Record<string, unknown>;

  baseline.Refreshed = "2024-03-01T08:00:00Z";
  latest.Refreshed = "2024-02-15T08:00:00Z";

  const { baselinePath, latestPath } = writeTempExports(baseline, latest);
  await analyzeWithDateOrderingWarning(page, baselinePath, latestPath);

  await expect(page.getByTestId("toast")).toBeVisible({ timeout: 10000 });
});

test("shows toast when reusing cached analysis with newer baseline dates", async ({ page }) => {
  const baseline = JSON.parse(fs.readFileSync(path.join(fixturesDir, "baseline.json"), "utf8")) as Record<string, unknown>;
  const latest = JSON.parse(fs.readFileSync(path.join(fixturesDir, "latest.json"), "utf8")) as Record<string, unknown>;

  baseline.Created = "2024-03-01T08:00:00Z";
  latest.Created = "2024-01-20T08:00:00Z";

  const { baselinePath, latestPath } = writeTempExports(baseline, latest);
  await analyzeWithDateOrderingWarning(page, baselinePath, latestPath);
  await expect(page.getByTestId("toast")).toBeVisible({ timeout: 10000 });

  await analyzeWithDateOrderingWarning(page, baselinePath, latestPath);
  await expect(page.getByTestId("toast")).toBeVisible({ timeout: 10000 });
});

test("detects Created dates on the first record before analysis", async ({ page }) => {
  const baseline = {
    Export: [{ ProjectCode: "A", Created: "2024-03-01T08:00:00Z" }]
  };
  const latest = {
    Export: [{ ProjectCode: "A", Created: "2024-01-20T08:00:00Z" }]
  };
  const { baselinePath, latestPath } = writeTempExports(baseline, latest);

  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baselinePath);
  await page.getByTestId("latest-input").setInputFiles(latestPath);

  await expect(page.getByTestId("global-file-order-warning")).toContainText("These files may be reversed");
  await expect(page.getByTestId("global-file-order-warning")).toContainText("read from first record");
  await expect(page.getByTestId("date-ordering-warning")).toBeVisible();
  await expect(page.getByTestId("toast")).toBeVisible();
});

test("confirms correct file order before analysis", async ({ page }) => {
  const baseline = {
    Export: [{ ProjectCode: "A", CreatedDate: "2024-01-01T08:00:00Z" }]
  };
  const latest = {
    Export: [{ ProjectCode: "A", CreatedDate: "2024-02-01T08:00:00Z" }]
  };
  const { baselinePath, latestPath } = writeTempExports(baseline, latest);

  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(baselinePath);
  await page.getByTestId("latest-input").setInputFiles(latestPath);

  await expect(page.getByTestId("global-file-order-correct")).toContainText("File order looks correct");
  await expect(page.getByTestId("global-file-order-warning")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveCount(0);
});
