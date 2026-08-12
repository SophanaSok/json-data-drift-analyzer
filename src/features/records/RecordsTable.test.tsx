/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordsTable } from "./RecordsTable";
import type { DiffRecord } from "../../engine/types";

// jsdom gives every element zero size, so the real virtualizer would render no
// rows; this stand-in renders them all. Keyboard behavior is what's under test.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 44,
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, start: index * 44 })),
    measure: () => {},
    measureElement: () => {}
  })
}));

function record(recordKey: string): DiffRecord {
  return {
    id: JSON.stringify([recordKey]),
    recordKey,
    status: "changed",
    latest: { Title: `Title ${recordKey}` },
    changedFields: [],
    changedFieldCount: 1,
    documentDiffs: {},
    severity: "medium"
  };
}

const records = [record("91B-2023"), record("92C-2023")];

afterEach(cleanup);

describe("RecordsTable keyboard access", () => {
  it("selects a row with Enter and with Space, without a mouse", async () => {
    const user = userEvent.setup();
    const onSelectRecord = vi.fn();
    render(
      <RecordsTable
        records={records}
        selectedRecordId={null}
        sort={{ column: "recordKey", direction: "asc" }}
        onSort={vi.fn()}
        onSelectRecord={onSelectRecord}
      />
    );

    const row = screen.getByTestId("record-91B-2023");
    expect(row.tabIndex).toBe(0);

    row.focus();
    await user.keyboard("{Enter}");
    expect(onSelectRecord).toHaveBeenCalledWith(JSON.stringify(["91B-2023"]));

    screen.getByTestId("record-92C-2023").focus();
    await user.keyboard(" ");
    expect(onSelectRecord).toHaveBeenCalledWith(JSON.stringify(["92C-2023"]));
  });

  it("exposes the sort state on the columnheader, where assistive tech looks for it", () => {
    render(
      <RecordsTable
        records={records}
        selectedRecordId={null}
        sort={{ column: "recordKey", direction: "desc" }}
        onSort={vi.fn()}
        onSelectRecord={vi.fn()}
      />
    );

    const sorted = screen
      .getAllByRole("columnheader")
      .find((header) => header.getAttribute("aria-sort") === "descending");
    expect(sorted?.textContent).toContain("Record");
    // The buttons inside no longer carry the misplaced attribute.
    expect(document.querySelector("button[aria-sort]")).toBeNull();
  });
});
