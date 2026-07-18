import type { AnalysisMetadata } from "../../engine/types";
import { ExportDateIndicators } from "../upload/ExportDateIndicators";

type ExportDateBannerProps = {
  metadata: AnalysisMetadata;
};

export function ExportDateBanner({ metadata }: ExportDateBannerProps) {
  const baselineExportDates = metadata.baselineExportDates ?? {};
  const latestExportDates = metadata.latestExportDates ?? {};
  const dateOrderingIssues = metadata.dateOrderingIssues ?? [];
  const hasDates = Object.keys(baselineExportDates).length > 0 || Object.keys(latestExportDates).length > 0;

  if (!hasDates && dateOrderingIssues.length === 0) return null;

  return (
    <div className="border-b bg-white px-6 py-4">
      {dateOrderingIssues.length > 0 ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="results-date-ordering-warning">
          <p className="font-medium">Comparing older baseline against newer latest export</p>
          <p className="mt-1">
            Baseline Refreshed/Created dates are older than the latest export. Review the highlighted dates to confirm this comparison is intentional.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {dateOrderingIssues.map((issue) => (
              <li key={issue.field}>
                {issue.field}: baseline {issue.baseline} vs latest {issue.latest}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ExportDateIndicators baselineDates={baselineExportDates} latestDates={latestExportDates} issues={dateOrderingIssues} />
    </div>
  );
}
