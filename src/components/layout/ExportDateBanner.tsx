import type { AnalysisMetadata } from "../../engine/types";
import { getAnalysisDateOrderingIssues } from "../../engine/export-metadata";
import { useUiStore } from "../../stores/ui-store";
import { ExportDateIndicators } from "../upload/ExportDateIndicators";

type ExportDateBannerProps = {
  metadata: AnalysisMetadata;
};

export function ExportDateBanner({ metadata }: ExportDateBannerProps) {
  const fileOrderAssessment = useUiStore((state) => state.fileOrderAssessment);
  const matchesSelectedFiles =
    fileOrderAssessment?.baselineFileName === metadata.baselineFileName &&
    fileOrderAssessment.latestFileName === metadata.latestFileName;
  const baselineExportDates = matchesSelectedFiles
    ? fileOrderAssessment.baseline.dates
    : metadata.baselineExportDates ?? {};
  const latestExportDates = matchesSelectedFiles
    ? fileOrderAssessment.latest.dates
    : metadata.latestExportDates ?? {};
  const dateOrderingIssues = matchesSelectedFiles
    ? fileOrderAssessment.issues
    : getAnalysisDateOrderingIssues(metadata);
  const hasDates = Object.keys(baselineExportDates).length > 0 || Object.keys(latestExportDates).length > 0;

  if (!hasDates && dateOrderingIssues.length === 0) return null;

  return (
    <div className="border-b bg-white px-6 py-4">
      {dateOrderingIssues.length > 0 ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="results-date-ordering-warning">
          <p className="font-medium">Baseline export dates are not older than latest</p>
          <p className="mt-1">
            This comparison may be misleading because baseline Refreshed/Created dates are newer than or equal to the latest export.
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
