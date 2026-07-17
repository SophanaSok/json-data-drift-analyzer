import type { DateOrderingIssue } from "../../engine/export-metadata";
import { ExportDateIndicators } from "./ExportDateIndicators";
import type { ExportDates } from "../../engine/export-metadata";

type DateOrderingAlertProps = {
  issues: DateOrderingIssue[];
  baselineDates: ExportDates;
  latestDates: ExportDates;
  onContinue: () => void;
  onCancel: () => void;
};

export function DateOrderingAlert({ issues, baselineDates, latestDates, onContinue, onCancel }: DateOrderingAlertProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="presentation">
      <div
        className="w-full max-w-2xl rounded-lg border border-amber-300 bg-white p-5 shadow-xl"
        role="alertdialog"
        aria-labelledby="date-ordering-alert-title"
        aria-describedby="date-ordering-alert-description"
      >
        <h2 id="date-ordering-alert-title" className="text-lg font-semibold text-amber-900">
          Baseline export dates look newer than latest
        </h2>
        <p id="date-ordering-alert-description" className="mt-2 text-sm text-slate-700">
          Baseline exports are usually older than later JSON files. The selected files have one or more Refreshed or Created dates that are newer than or equal to the latest export, which can make drift results misleading.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {issues.map((issue) => (
            <li key={issue.field}>
              {issue.field}: baseline <span className="font-medium">{issue.baseline}</span> is not older than latest <span className="font-medium">{issue.latest}</span>
            </li>
          ))}
        </ul>
        <ExportDateIndicators baselineDates={baselineDates} latestDates={latestDates} issues={issues} />
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700" data-testid="date-ordering-continue" onClick={onContinue} type="button">
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
