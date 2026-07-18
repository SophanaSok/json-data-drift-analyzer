import { expect, test } from "@playwright/test";
import path from "node:path";

const root = "/home/runner/work/json-data-drift-analyzer/json-data-drift-analyzer";

test("smoke analysis flow", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("baseline-input").setInputFiles(path.join(root, "src/test/fixtures/baseline.json"));
  await page.getByTestId("latest-input").setInputFiles(path.join(root, "src/test/fixtures/latest.json"));
  await page.getByTestId("analyze-button").click();
  await page.getByTestId("date-ordering-continue").click();
  await expect(page.getByText("Deterministic incident narrative")).toBeVisible();

  await page.getByRole("link", { name: "Records", exact: true }).click();
  await expect(page.getByText("Showing")).toBeVisible();

  await page.getByRole("button", { name: "changed", exact: true }).click();
  await page.getByRole("combobox").nth(0).selectOption("Title");
  await page.getByRole("combobox").nth(1).selectOption("emptied");

  await page.getByTestId("record-91B-2023").click();
  await expect(page.getByTestId("record-details")).toBeVisible();
  await expect(page.getByTestId("field-changes")).toBeVisible();
  await expect(page.getByTestId("field-change-Title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Baseline", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View document comparison" }).click();
  await expect(page.getByTestId("document-comparison")).toBeVisible();
});
