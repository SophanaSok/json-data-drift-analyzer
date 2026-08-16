import { expect, test } from "@playwright/test";
import path from "node:path";

const root = process.cwd();

/**
 * Exercises the real Content-Security-Policy against the built output.
 *
 * A CSP that is too strict fails silently in ways unit tests cannot see: a blocked
 * worker, a blocked stylesheet, a download that never starts. These run the actual
 * flows with violations collected from the browser's own `securitypolicyviolation`
 * event — not by matching Chrome's console phrasing, which changes between versions
 * and would make the assertions silently vacuous.
 */
async function trackCspViolations(page: import("@playwright/test").Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const holder = window as unknown as { __cspViolations: string[] };
    holder.__cspViolations = [];
    window.addEventListener("securitypolicyviolation", (event) => {
      holder.__cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI || event.sourceFile || "inline"}`
      );
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations ?? []);
}

test("the built page carries the policy", async ({ page }) => {
  await page.goto("");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");

  expect(csp).toBeTruthy();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  // The directive that stops an injected script exfiltrating the Trello token.
  expect(csp).toContain("connect-src 'self' https://api.trello.com");
});

test("the build ships 404.html as an app-shell copy for GitHub Pages deep links", async ({ page }) => {
  // Pages has no rewrite rules; it serves 404.html for unknown paths. A hard
  // refresh on /results or /profiles only boots the router (and the
  // restore-from-cache flow) if that file is the app shell itself.
  const response = await page.request.get("404.html");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('<div id="root">');
  // The CSP meta tag must ride along: the fallback page runs the same app.
  expect(body).toContain('http-equiv="Content-Security-Policy"');
});

test("the violation listener itself works, so empty results below mean something", async ({ page }) => {
  // A detection mechanism that cannot fire proves nothing. Trigger one deliberate
  // violation (an image from a host connect-src/img-src does not allow) and require
  // the listener to see it.
  const violations = await trackCspViolations(page);

  await page.goto("");
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.src = "https://example.invalid/pixel.png";
    document.body.appendChild(img);
  });
  await expect.poll(violations).not.toEqual([]);
});

test("the app loads and analyses without violating the policy", async ({ page }) => {
  const violations = await trackCspViolations(page);

  await page.goto("");
  await page
    .getByTestId("baseline-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
  await page
    .getByTestId("latest-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
  await page.getByTestId("analyze-button").click();

  // Reaching results proves the worker ran, which is the load most likely to be
  // blocked by worker-src.
  await expect(page.getByText("Deterministic incident narrative")).toBeVisible({ timeout: 30000 });
  expect(await violations()).toEqual([]);
});

test("virtualized rows still position, so inline styles are permitted", async ({ page }) => {
  const violations = await trackCspViolations(page);

  await page.goto("");
  await page
    .getByTestId("baseline-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
  await page
    .getByTestId("latest-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
  await page.getByTestId("analyze-button").click();
  await page.getByRole("link", { name: "Recovery", exact: true }).click();
  await expect(page.getByTestId("findings-explorer")).toBeVisible({ timeout: 30000 });

  const row = page.locator('[data-testid^="finding-row-"]').first();
  await expect(row).toBeVisible();
  // A blocked style attribute would leave every row stacked at the origin.
  await expect(row).toHaveAttribute("style", /transform/);
  expect(await violations()).toEqual([]);
});

test("downloads still work under the policy", async ({ page }) => {
  const violations = await trackCspViolations(page);

  await page.goto("");
  await page
    .getByTestId("baseline-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-reference.json"));
  await page
    .getByTestId("latest-input")
    .setInputFiles(path.join(root, "src/test/fixtures/bellingham-candidate.json"));
  await page.getByTestId("analyze-button").click();
  await page.getByRole("link", { name: "Recovery", exact: true }).click();
  await expect(page.getByTestId("export-section")).toBeVisible({ timeout: 30000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-recovered").click();
  const download = await downloadPromise;

  // Object URLs are how every export is delivered; a policy that blocked them
  // would break the feature silently.
  expect(download.suggestedFilename()).toContain("recovered");
  expect(await violations()).toEqual([]);
});
