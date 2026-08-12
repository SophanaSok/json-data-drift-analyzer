import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordSortColumn } from "./record-table";
import { clampColumnWidth, loadRecordColumnWidths, saveRecordColumnWidths } from "./record-column-widths";

type ColumnWidths = Record<RecordSortColumn, number>;

type ResizeState = {
  columnId: RecordSortColumn;
  startX: number;
  startWidth: number;
};

export function useRecordColumnResize(onWidthsChange?: () => void) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => loadRecordColumnWidths());
  const resizeRef = useRef<ResizeState | null>(null);
  // Mirrors state so mouseup can persist the latest widths without a storage
  // write inside a setState updater — updaters must stay pure (StrictMode
  // double-invokes them, which would double the write).
  const widthsRef = useRef(columnWidths);
  useEffect(() => {
    widthsRef.current = columnWidths;
  }, [columnWidths]);

  const beginResize = useCallback((columnId: RecordSortColumn, startX: number) => {
    resizeRef.current = {
      columnId,
      startX,
      startWidth: columnWidths[columnId]
    };
  }, [columnWidths]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resize = resizeRef.current;
      if (!resize) return;

      const nextWidth = clampColumnWidth(resize.startWidth + (event.clientX - resize.startX));
      setColumnWidths((current) => {
        if (current[resize.columnId] === nextWidth) return current;
        return { ...current, [resize.columnId]: nextWidth };
      });
    };

    const handleMouseUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      saveRecordColumnWidths(widthsRef.current);
      onWidthsChange?.();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onWidthsChange]);

  return {
    columnWidths,
    beginResize
  };
}
