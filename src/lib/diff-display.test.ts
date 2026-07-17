import { describe, expect, it } from "vitest";
import {
  changeKindStyles,
  formatDiffValue,
  isFieldPathChanged
} from "./diff-display";

describe("diff-display", () => {
  it("formats diff values for display", () => {
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue("")).toBe('""');
    expect(formatDiffValue("hello")).toBe('"hello"');
  });

  it("detects changed top-level paths including nested changes", () => {
    const changed = new Set(["Title", "BidDocuments.0.Title"]);
    expect(isFieldPathChanged("Title", changed)).toBe(true);
    expect(isFieldPathChanged("BidDocuments", changed)).toBe(true);
    expect(isFieldPathChanged("Description", changed)).toBe(false);
  });

  it("returns styles for each change kind", () => {
    expect(changeKindStyles("emptied").row).toContain("red");
    expect(changeKindStyles("restored").row).toContain("emerald");
    expect(changeKindStyles("modified").row).toContain("amber");
  });
});
