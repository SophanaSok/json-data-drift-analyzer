import { expect, test } from "@playwright/test";
import path from "node:path";

const root = process.cwd();

/**
 * The searchable profile picker and file-based auto-detection.
 *
 * One profile ships today, so these tests exercise the mechanics — filtering,
 * empty state, keyboard selection, persistence — rather than cross-profile
 * disambiguation, which unit tests cover with synthetic registries.
 */
test.describe("profile picker", () => {
  test("shows the selection closed and filters when typing", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v6/);

    await picker.click();
    await expect(page.getByTestId("profile-picker-listbox")).toBeVisible();
    await picker.fill("procureware");
    await expect(page.getByTestId("profile-option-bellingham-procureware")).toBeVisible();

    await picker.fill("no-such-source");
    await expect(page.getByTestId("profile-picker-empty")).toBeVisible();
  });

  test("selects with the keyboard and closes", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await picker.click();
    await picker.fill("bellingham");
    await picker.press("ArrowDown");
    await picker.press("Enter");
    await expect(page.getByTestId("profile-picker-listbox")).not.toBeVisible();
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v6/);
  });

  test("escape reverts without committing a filter", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await picker.click();
    await picker.fill("zzz");
    await picker.press("Escape");
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v6/);
  });

  test("keeps the selection across a reload", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await picker.click();
    await picker.press("ArrowDown");
    await picker.press("Enter");
    await page.reload();
    await expect(page.getByTestId("source-profile-select")).toHaveValue(/Bellingham ProcureWare · v6/);
  });

  test("detects the source from the uploaded files and says so", async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    // The fixtures' BidURL values start with the profile's sourceUrl.
    await expect(page.getByTestId("profile-detection-notice")).toBeVisible();
    await expect(page.getByTestId("profile-detection-notice")).toContainText("cob.procureware.com");
    // Same source on both sides: no mismatch, no cross-source warning.
    await expect(page.getByTestId("profile-detection-mismatch")).not.toBeVisible();
    await expect(page.getByTestId("profile-detection-cross-source")).not.toBeVisible();
  });

  test("derives collection path and identity from the profile with an escape hatch", async ({ page }) => {
    await page.goto("");
    const collectionPath = page.getByPlaceholder("Export or $");
    await expect(collectionPath).toHaveValue("Export");
    await collectionPath.fill("SomethingElse");
    await expect(page.getByTestId("collection-path-customized")).toBeVisible();
    await page.getByRole("button", { name: "Reset to profile" }).click();
    await expect(collectionPath).toHaveValue("Export");
    await expect(page.getByTestId("collection-path-customized")).not.toBeVisible();
  });
});
