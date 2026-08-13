import { expect, test } from "@playwright/test";

/**
 * The /profiles page and the local-override lifecycle end to end:
 * create → coherence refusal → save → badges everywhere → export → remove.
 */
test.describe("profiles page", () => {
  test("lists the registered profiles and shows the resolved policy", async ({ page }) => {
    await page.goto("");
    await page.getByTestId("profiles-link").click();
    await expect(page.getByTestId("profiles-page")).toBeVisible();
    await page.getByTestId("profiles-row-bellingham-procureware").click();
    await expect(page.getByTestId("profile-detail")).toContainText("Bellingham ProcureWare");
    await expect(page.getByTestId("profile-effective-version")).toContainText("Repo v6");
    await expect(page.getByTestId("profile-detail")).toContainText("ContactPhone, ContactEmail, BidType, Title");
  });

  test("refuses an incoherent override and names the contradiction", async ({ page }) => {
    await page.goto("profiles?id=bellingham-procureware");
    await page.getByTestId("edit-override").click();
    // BidStatus is manual-review; approving it for backfill contradicts that.
    await page.getByTestId("override-safeBackfillFields").fill("Title, BidStatus");
    await page.getByTestId("override-reason").fill("testing coherence");
    await page.getByTestId("override-save").click();
    await expect(page.getByTestId("override-problems")).toContainText("automatic and human-only");
  });

  test("saves an override, shows it everywhere, exports it, and removes it", async ({ page }) => {
    await page.goto("profiles?id=bellingham-procureware");

    // Save: drop Title from the approved backfill list.
    await page.getByTestId("edit-override").click();
    await page.getByTestId("override-safeBackfillFields").fill("ContactPhone, ContactEmail, BidType");
    await page.getByTestId("override-reason").fill("Title backfill suspended pending re-review of retitled solicitations.");
    await page.getByTestId("override-save").click();

    // The detail view shows the override identity and the diff.
    await expect(page.getByTestId("profile-effective-version")).toContainText("local override rev 1");
    await expect(page.getByTestId("override-diff")).toContainText("safeBackfillFields");
    await expect(page.getByTestId("override-diff")).toContainText("−Title");

    // The upload page runs under it and says so.
    await page.getByTestId("new-analysis-link").click();
    await expect(page.getByTestId("profile-override-badge")).toBeVisible();
    await expect(page.getByTestId("profile-override-badge")).toContainText("override rev 1");
    await expect(page.getByText("Approved fields:")).not.toContainText("Title");

    // It survives a reload (IndexedDB, not component state).
    await page.reload();
    await expect(page.getByTestId("profile-override-badge")).toBeVisible();

    // Export produces the override JSON, named for upstreaming.
    await page.getByTestId("manage-profiles-link").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-override").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bellingham-procureware.override.json");

    // Remove behind the inline confirm; the repo policy returns.
    await page.getByTestId("reset-override").click();
    await page.getByTestId("confirm-reset-override").click();
    await expect(page.getByTestId("profile-effective-version")).not.toContainText("local override");
    await page.getByTestId("new-analysis-link").click();
    await expect(page.getByTestId("profile-override-badge")).not.toBeVisible();
    await expect(page.getByText("Approved fields:")).toContainText("Title");
  });
});
