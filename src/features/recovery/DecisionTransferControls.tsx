import { useRef, useState } from "react";
import {
  buildDecisionTransferArtifact,
  rebaseDecisionTransfer,
  validateDecisionTransfer
} from "../../engine/decisions-transfer";
import { downloadArtifact } from "../../engine/export";
import type { RecoveryDecision } from "../../engine/decisions";
import type { RecoveryReview } from "../../engine/review";
import { useToastStore } from "../../stores/toast-store";

type DecisionTransferControlsProps = {
  review: RecoveryReview;
  log: RecoveryDecision[];
  onRecord: (log: RecoveryDecision[]) => void;
};

/**
 * Hand a half-finished review to a colleague: export the decision log as JSON,
 * import theirs. Import is refused unless the file verifiably describes this
 * same review (profile, version, policy hash, input SHA-256s) — a decision
 * made against different data or policy is not evidence here.
 */
export function DecisionTransferControls({ review, log, onRecord }: DecisionTransferControlsProps) {
  const showToast = useToastStore((state) => state.showToast);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const importFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setProblems(["The selected file is not valid JSON."]);
      return;
    }
    const validated = validateDecisionTransfer(parsed);
    if (!validated.ok) {
      setProblems(validated.problems);
      return;
    }
    const rebase = rebaseDecisionTransfer(validated.value, review, log);
    if (!rebase.ok) {
      setProblems(rebase.problems);
      return;
    }
    setProblems([]);
    if (rebase.decisions.length === 0) {
      showToast(`Nothing to import — all ${rebase.skippedExisting} decision(s) are already in this log.`);
      return;
    }
    onRecord([...log, ...rebase.decisions]);
    showToast(
      `Imported ${rebase.decisions.length} decision(s)` +
        (rebase.skippedExisting > 0 ? `, skipped ${rebase.skippedExisting} already present.` : ".")
    );
  };

  return (
    <section className="rounded border bg-white p-4" data-testid="decision-transfer">
      <h3 className="font-medium">Decision log transfer</h3>
      <p className="mt-1 text-xs text-slate-500">
        Decisions live only in this browser. Export them to hand this review to a colleague; import theirs to
        continue where they stopped. A file is accepted only when it matches this exact review — same profile,
        same policy, same input files by SHA-256 — and imported decisions append after yours, so the newest
        decision for a cell still wins, visibly.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100 disabled:text-slate-400"
          data-testid="export-decisions"
          disabled={log.length === 0}
          onClick={() => downloadArtifact(buildDecisionTransferArtifact(review, log, new Date().toISOString()))}
        >
          Export decision log ({log.length})
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
          data-testid="import-decisions"
          onClick={() => fileRef.current?.click()}
        >
          Import decision log…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          data-testid="decision-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = "";
          }}
        />
      </div>
      {problems.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700" data-testid="decision-import-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
