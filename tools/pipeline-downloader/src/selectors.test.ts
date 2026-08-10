import { describe, expect, it } from "vitest";
import { DownloadError } from "./errors.ts";
import {
  assertSelectorsConfigured,
  fillTemplate,
  isConfigured,
  PLACEHOLDER,
  selectorConfig,
  unconfiguredSelectors,
  type SelectorConfig
} from "./selectors.ts";

const configured: SelectorConfig = {
  loginPath: "/login",
  usernameField: "#username",
  passwordField: "#password",
  submitButton: "button[type=submit]",
  loggedInMarker: "[data-testid=account-menu]",
  loginErrorMarker: PLACEHOLDER,
  runsPath: "/bots/{botId}/runs",
  latestRunRow: "tbody tr:first-child",
  runRow: "tr[data-run='{runTimestamp}']",
  runTimestampCell: "td.timestamp",
  downloadControl: { candidate: "a.candidate", reference: "a.reference" }
};

describe("unconfiguredSelectors", () => {
  it("reports the shipped config as entirely unfilled", () => {
    // The guard that keeps this prototype from pretending it knows the dashboard.
    const unfilled = unconfiguredSelectors(selectorConfig);
    expect(unfilled).toContain("loginPath");
    expect(unfilled).toContain("downloadControl.candidate");
    expect(unfilled).toContain("downloadControl.reference");
  });

  it("treats a fully filled config as ready", () => {
    expect(unconfiguredSelectors(configured)).toEqual([]);
  });

  it("does not require the optional login error marker", () => {
    expect(unconfiguredSelectors(configured)).not.toContain("loginErrorMarker");
  });

  it("counts an empty string as unfilled", () => {
    expect(unconfiguredSelectors({ ...configured, runsPath: "  " })).toEqual(["runsPath"]);
  });
});

describe("assertSelectorsConfigured", () => {
  it("refuses to proceed while placeholders remain, and names them", () => {
    expect(() => assertSelectorsConfigured(selectorConfig)).toThrow(DownloadError);
    expect(() => assertSelectorsConfigured(selectorConfig)).toThrow(/placeholder/);
  });

  it("passes once every required selector is filled in", () => {
    expect(() => assertSelectorsConfigured(configured)).not.toThrow();
  });
});

describe("fillTemplate", () => {
  it("substitutes the runtime values", () => {
    expect(fillTemplate("/bots/{botId}/runs", { botId: "lambda" })).toBe("/bots/lambda/runs");
    expect(fillTemplate("tr[data-run='{runTimestamp}']", { runTimestamp: "2026-07-15 08:02:12" })).toBe(
      "tr[data-run='2026-07-15 08:02:12']"
    );
  });

  it("leaves a template with no placeholders alone", () => {
    expect(fillTemplate("tbody tr:first-child", {})).toBe("tbody tr:first-child");
  });

  it("fails loudly on a placeholder nobody supplies", () => {
    expect(() => fillTemplate("/bots/{botID}/runs", { botId: "lambda" })).toThrow(/unknown value/);
  });
});

describe("isConfigured", () => {
  it("distinguishes a real selector from the sentinel", () => {
    expect(isConfigured("#username")).toBe(true);
    expect(isConfigured(PLACEHOLDER)).toBe(false);
    expect(isConfigured("   ")).toBe(false);
  });
});
