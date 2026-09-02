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
  test("warns when no known source matches the uploaded files", async ({ page }) => {
    // The tiny fixture pair uses example.gov URLs, which no profile claims —
    // the page must say the selected policy will apply rather than staying
    // silent while a source-specific profile governs unrelated data.
    await page.goto("");
    await page.getByTestId("baseline-input").setInputFiles(path.join(root, "src/test/fixtures/baseline.json"));
    await page.getByTestId("latest-input").setInputFiles(path.join(root, "src/test/fixtures/latest.json"));

    const notice = page.getByTestId("profile-detection-none");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("No known source matched these files");
    await expect(notice).toContainText("Bellingham ProcureWare");
  });

  test("shows the selection closed and filters when typing", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v8/);

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
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v8/);
  });

  test("escape reverts without committing a filter", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    await picker.click();
    await picker.fill("zzz");
    await picker.press("Escape");
    await expect(picker).toHaveValue(/Bellingham ProcureWare · v8/);
  });

  test("keeps the selection across a reload", async ({ page }) => {
    await page.goto("");
    const picker = page.getByTestId("source-profile-select");
    // Pick a profile that is NOT the default, so a reload that silently fell
    // back to the default would fail this test.
    await picker.click();
    await picker.fill("Nashville");
    await picker.press("ArrowDown");
    await picker.press("Enter");
    await expect(picker).toHaveValue(/Nashville-Davidson County Met Gov TN-01 · v1/);
    await page.reload();
    await expect(page.getByTestId("source-profile-select")).toHaveValue(/Nashville-Davidson County Met Gov TN-01 · v1/);
  });

  test("detects the source from the uploaded files and says so", async ({ page }) => {
    await page.goto("");
    await page
      .getByTestId("baseline-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
    await page
      .getByTestId("latest-input")
      .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
    // The fixtures carry the profile's bot identity (v8), which outranks the
    // BidURL host prefix the profile also matches on.
    await expect(page.getByTestId("profile-detection-notice")).toBeVisible();
    await expect(page.getByTestId("profile-detection-notice")).toContainText(
      'AgentID is "1431" and AgentName is "Bellingham WA - PW-02"'
    );
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
