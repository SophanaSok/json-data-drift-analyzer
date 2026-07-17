/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clampColumnWidth,
  DEFAULT_RECORD_COLUMN_WIDTHS,
  getTotalColumnWidth,
  loadRecordColumnWidths,
  MIN_RECORD_COLUMN_WIDTH,
  RECORD_COLUMN_WIDTHS_STORAGE_KEY,
  saveRecordColumnWidths
} from "./record-column-widths";

describe("record column widths", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("clamps widths to the configured minimum", () => {
    expect(clampColumnWidth(20)).toBe(MIN_RECORD_COLUMN_WIDTH);
    expect(clampColumnWidth(120.6)).toBe(121);
  });

  it("sums column widths for table layout", () => {
    expect(getTotalColumnWidth(DEFAULT_RECORD_COLUMN_WIDTHS)).toBe(1020);
  });

  it("loads defaults when storage is empty", () => {
    expect(loadRecordColumnWidths()).toEqual(DEFAULT_RECORD_COLUMN_WIDTHS);
  });

  it("persists and restores valid widths", () => {
    const custom = { ...DEFAULT_RECORD_COLUMN_WIDTHS, title: 360 };
    saveRecordColumnWidths(custom);
    expect(window.localStorage.getItem(RECORD_COLUMN_WIDTHS_STORAGE_KEY)).toContain('"title":360');
    expect(loadRecordColumnWidths().title).toBe(360);
  });

  it("ignores invalid stored widths", () => {
    window.localStorage.setItem(RECORD_COLUMN_WIDTHS_STORAGE_KEY, '{"title":"wide"}');
    expect(loadRecordColumnWidths().title).toBe(DEFAULT_RECORD_COLUMN_WIDTHS.title);
  });
});
