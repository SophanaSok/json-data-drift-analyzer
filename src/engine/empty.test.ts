import { describe, expect, it } from "vitest";
import { isEmpty } from "./empty";

describe("isEmpty", () => {
  it("handles nullish and whitespace", () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty("   ")).toBe(true);
  });

  it("handles placeholders", () => {
    expect(isEmpty("N/A")).toBe(true);
    expect(isEmpty("Unknown")).toBe(true);
  });

  it("does not treat zero or false as empty", () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
  });

  it("handles empty arrays by rule", () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty([], { allowEmptyArray: true })).toBe(false);
  });
});
