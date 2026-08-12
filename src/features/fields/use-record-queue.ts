import { useEffect, useMemo, useRef } from "react";
import { cellId, type RecoveryDecision } from "../../engine/decisions";
import type { RecordSummary } from "../../engine/field-view";

export type QueueRow = RecordSummary & {
  /** Review-lane cells without a decision in force. */
  pendingCount: number;
  /** True when the record had review cells and every one now has a decision. */
  resolved: boolean;
};

export type RecordQueue = {
  rows: QueueRow[];
  index: number;
  current: QueueRow | null;
  progress: { resolvedRecords: number; recordsWithPending: number };
  /** True when no record has pending decisions left. */
  complete: boolean;
  previous: () => void;
  next: () => void;
  nextPending: () => void;
};

/** Actions the record panel exposes to the keymap. */
export type RecordShortcutActions = {
  acceptAll: () => void;
  keepAll: () => void;
  selectField: (position: number) => void;
  acceptSelectedField: () => void;
  keepSelectedField: () => void;
  editSelectedField: () => void;
  toggleFocusMode: () => void;
  toggleHelp: () => void;
  cancel: () => void;
};

/**
 * True when a keystroke should be typed rather than treated as a command.
 *
 * Tag alone is wrong: a checkbox is an INPUT, so a tag-only guard kills every
 * shortcut for as long as focus rests on the rule-6 checkbox — exactly when the
 * user is one key away from advancing.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = target.type.toLowerCase();
    return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
  }
  return false;
}

/**
 * The cursor for record-by-record work: position in the ordered record list,
 * exact per-record pending counts from the decision log, and the keyboard
 * commands that drive the queue without a mouse.
 */
export function useRecordQueue(
  summaries: RecordSummary[],
  resolved: Map<string, RecoveryDecision>,
  selectedRecordKey: string | null,
  onSelect: (recordKey: string) => void,
  keyboardEnabled: boolean,
  actions?: RecordShortcutActions
): RecordQueue {
  const rows = useMemo<QueueRow[]>(
    () =>
      summaries.map((summary) => {
        const pendingCount =
          summary.decisionRecordKey === null
            ? 0
            : summary.reviewFields.filter(
                (field) => !resolved.has(cellId(summary.decisionRecordKey!, field))
              ).length;
        return {
          ...summary,
          pendingCount,
          resolved: summary.reviewFields.length > 0 && pendingCount === 0
        };
      }),
    [summaries, resolved]
  );

  const index = useMemo(
    () => rows.findIndex((row) => row.recordKey === selectedRecordKey),
    [rows, selectedRecordKey]
  );
  const current = index >= 0 ? rows[index]! : null;

  const progress = useMemo(() => {
    let resolvedRecords = 0;
    let recordsWithPending = 0;
    for (const row of rows) {
      if (row.reviewFields.length === 0) continue;
      recordsWithPending += 1;
      if (row.resolved) resolvedRecords += 1;
    }
    return { resolvedRecords, recordsWithPending };
  }, [rows]);

  const complete = useMemo(() => rows.every((row) => row.pendingCount === 0), [rows]);

  // Wrapping, like nextPending: `j` at the end of 499 records silently doing
  // nothing reads as a broken key, not as a boundary.
  const step = (delta: number) => {
    if (rows.length === 0) return;
    const from = index >= 0 ? index : delta > 0 ? -1 : 0;
    const to = (from + delta + rows.length) % rows.length;
    onSelect(rows[to]!.recordKey);
  };

  const nextPending = () => {
    if (rows.length === 0) return;
    const from = index >= 0 ? index : -1;
    for (let offset = 1; offset <= rows.length; offset += 1) {
      const row = rows[(from + offset) % rows.length]!;
      if (row.pendingCount > 0) {
        onSelect(row.recordKey);
        return;
      }
    }
  };

  // The handler closes over fresh state every render; a ref keeps the listener
  // itself registered once instead of churning on every keystroke on the page.
  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  handlerRef.current = (event: KeyboardEvent) => {
    if (isTextEntry(event.target)) return;
    // Never shadow a browser or OS chord: today's bare-key match hijacks
    // Ctrl+J, Cmd+N and friends.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "j":
        step(1);
        break;
      case "k":
        step(-1);
        break;
      case "n":
        nextPending();
        break;
      case "a":
        actions?.acceptAll();
        break;
      case "x":
        actions?.keepAll();
        break;
      case "e":
        actions?.editSelectedField();
        break;
      case "c":
        actions?.keepSelectedField();
        break;
      case "Enter":
        actions?.acceptSelectedField();
        break;
      case "f":
        actions?.toggleFocusMode();
        break;
      case "?":
        actions?.toggleHelp();
        break;
      case "Escape":
        actions?.cancel();
        break;
      default:
        if (/^[1-9]$/.test(event.key)) {
          actions?.selectField(Number(event.key) - 1);
          break;
        }
        return;
    }
    event.preventDefault();
  };

  useEffect(() => {
    if (!keyboardEnabled) return;
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [keyboardEnabled]);

  return {
    rows,
    index,
    current,
    progress,
    complete,
    previous: () => step(-1),
    next: () => step(1),
    nextPending
  };
}
