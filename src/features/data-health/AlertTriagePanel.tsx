import { Link } from "react-router-dom";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useToastStore } from "../../stores/toast-store";
import type { TriageVerdict } from "./triage";

/**
 * The answer to "why is this run on hold?", in the alert's own terms.
 *
 * The pipeline holds a batch when three or more records share a title; most of
 * those holds are recurring annual solicitations that were in the last good run
 * too. The reference count on each group is what separates the two cases, so it is
 * the thing this panel leads with, and the copy button hands the analyst a note
 * stating exactly that. Releasing the hold stays a manual action in the pipeline.
 */

const TONE: Record<TriageVerdict["outcome"], { border: string; text: string; label: string }> = {
  new: { border: "border-amber-400 bg-amber-50", text: "text-amber-900", label: "Needs a look" },
  recurring: { border: "border-emerald-400 bg-emerald-50", text: "text-emerald-900", label: "Recurring, not new" },
  clear: { border: "border-emerald-400 bg-emerald-50", text: "text-emerald-900", label: "Clear" },
  "not-configured": { border: "border-slate-300 bg-slate-50", text: "text-slate-700", label: "Not checked" }
};

export function AlertTriagePanel({
  verdict,
  note,
  showGroups = false
}: {
  verdict: TriageVerdict;
  note: string;
  /** The Data Health tab lists the groups; Overview states the verdict only. */
  showGroups?: boolean;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const tone = TONE[verdict.outcome];

  const onCopy = () => {
    void copyTextToClipboard(note).then((copied) => {
      showToast(
        copied ? "Triage note copied." : "Could not copy the note; select and copy it manually.",
        copied ? "info" : "warning"
      );
    });
  };

  return (
    <section className={`rounded border-2 p-4 ${tone.border}`} data-testid="alert-triage" data-outcome={verdict.outcome}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Duplicate-title alert</h3>
        <span className={`rounded bg-white/70 px-2 py-0.5 text-xs font-semibold ${tone.text}`} data-testid="triage-label">
          {tone.label}
        </span>
      </div>

      <p className={`mt-2 text-sm ${tone.text}`} data-testid="triage-headline">
        {verdict.headline}
      </p>

      {verdict.outcome !== "not-configured" ? (
        <p className="mt-1 text-xs text-slate-600">
          Mirrors the pipeline's own check ({verdict.field} shared by {verdict.threshold} or more records). Comparing
          against the reference run is what tells a recurring solicitation from new duplication — this tool never
          releases a hold.
        </p>
      ) : null}

      {showGroups && verdict.groups.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Title groups at or above the alert threshold</caption>
            <thead className="text-xs text-slate-500">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {verdict.field}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  This run
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Reference
                </th>
                <th scope="col" className="py-1 font-medium">
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {verdict.groups.map((group, index) => (
                <tr key={group.title} className="border-t align-top" data-testid={`triage-group-${index}`}>
                  <td className="py-1 pr-3">
                    <Link
                      className="text-sky-700 underline"
                      to={`/results?tab=records&q=${encodeURIComponent(group.title)}`}
                    >
                      {group.title}
                    </Link>
                  </td>
                  <td className="py-1 pr-3 tabular-nums">{group.candidateCount}</td>
                  <td className="py-1 pr-3 tabular-nums">{group.referenceCount}</td>
                  <td className={`py-1 ${group.preExisting ? "text-slate-600" : "font-semibold text-amber-900"}`}>
                    {group.preExisting ? "also in reference" : "new in this run"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded border border-slate-400 bg-white px-3 py-1 text-sm text-slate-800 hover:bg-slate-100"
          data-testid="triage-copy"
          onClick={onCopy}
        >
          Copy triage note
        </button>
        {!showGroups ? (
          <Link className="text-sm text-sky-700 underline" to="/results?tab=data-health" data-testid="triage-details-link">
            Open Data Health
          </Link>
        ) : null}
      </div>
    </section>
  );
}
