import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DateOrderingAlert } from "../../components/upload/DateOrderingAlert";
import { ExportDateIndicators } from "../../components/upload/ExportDateIndicators";
import { db } from "../../db";
import { extractExportDates, findDateOrderingIssues } from "../../engine/export-metadata";
import type { ExportDates } from "../../engine/types";
import { defaultProfile } from "../../engine/profile";
import { hashText } from "../../lib/hash";
import { findDateOrderingIssuesFromJson } from "../../lib/date-ordering-toast";
import { useUiStore } from "../../stores/ui-store";
import type { AnalyzeRequest, WorkerMessage } from "../../workers/protocol";

const worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), { type: "module" });

function parseCsvInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readExportDates(file: File | null) {
  if (!file) return {};
  try {
    const data = JSON.parse(await file.text()) as unknown;
    return extractExportDates(data);
  } catch {
    return {};
  }
}

export function UploadPage() {
  const navigate = useNavigate();
  const [baselineFile, setBaselineFile] = useState<File | null>(null);
  const [latestFile, setLatestFile] = useState<File | null>(null);
  const [baselineExportDates, setBaselineExportDates] = useState<ExportDates>({});
  const [latestExportDates, setLatestExportDates] = useState<ExportDates>({});
  const [collectionPath, setCollectionPath] = useState("Export");
  const [identityKeys, setIdentityKeys] = useState(defaultProfile.identityDefault.join(","));
  const [ignoredFields, setIgnoredFields] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAlert, setPendingAlert] = useState(false);
  const step = useUiStore((state) => state.workerStep);
  const setStep = useUiStore((state) => state.setWorkerStep);
  const setAnalysis = useUiStore((state) => state.setAnalysis);
  const setPendingDateOrderingIssues = useUiStore((state) => state.setPendingDateOrderingIssues);
  const disabled = useMemo(() => !baselineFile || !latestFile, [baselineFile, latestFile]);
  const dateOrderingIssues = useMemo(
    () => findDateOrderingIssues(baselineExportDates, latestExportDates),
    [baselineExportDates, latestExportDates]
  );

  useEffect(() => {
    void readExportDates(baselineFile).then(setBaselineExportDates);
  }, [baselineFile]);

  useEffect(() => {
    void readExportDates(latestFile).then(setLatestExportDates);
  }, [latestFile]);

  const runAnalysis = async () => {
    if (!baselineFile || !latestFile) return;
    setError(null);
    try {
      const baselineText = await baselineFile.text();
      const latestText = await latestFile.text();
      const orderingIssues = findDateOrderingIssuesFromJson(baselineText, latestText);
      const identityFields = parseCsvInput(identityKeys);
      const ignored = parseCsvInput(ignoredFields);
      const analysisKey = await hashText(
        [
          await hashText(baselineText),
          await hashText(latestText),
          collectionPath,
          identityFields.join("|"),
          ignored.join("|"),
          defaultProfile.id,
          String(defaultProfile.version)
        ].join("::")
      );

      const cached = await db.analyses.get(analysisKey);
      if (cached) {
        setPendingDateOrderingIssues(orderingIssues);
        setAnalysis(cached.result);
        navigate(`/results?tab=${cached.result.qualityIssues.some((issue) => ["critical", "high"].includes(issue.severity)) ? "overview" : "records"}`);
        return;
      }

      const request: AnalyzeRequest = {
        type: "analyze",
        payload: {
          baselineFileName: baselineFile.name,
          latestFileName: latestFile.name,
          baselineText,
          latestText,
          analysisKey,
          config: {
            collectionPath,
            identityFields,
            ignoredFields: ignored,
            profileId: defaultProfile.id
          },
          profile: defaultProfile
        }
      };

      worker.postMessage(request);
      worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "progress") {
          setStep(event.data.payload.step);
          return;
        }
        if (event.data.type === "error") {
          setError(event.data.payload.message);
          return;
        }
        setStep("Ready");
        setPendingDateOrderingIssues(
          (event.data.payload.metadata.dateOrderingIssues?.length ?? 0) > 0
            ? event.data.payload.metadata.dateOrderingIssues
            : orderingIssues
        );
        setAnalysis(event.data.payload);
        await db.analyses.put({ analysisKey, createdAt: new Date().toISOString(), result: event.data.payload });
        navigate(`/results?tab=${event.data.payload.qualityIssues.some((issue) => ["critical", "high"].includes(issue.severity)) ? "overview" : "records"}`);
      };
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Failed to analyze files");
    }
  };

  const onAnalyze = () => {
    if (dateOrderingIssues.length > 0) {
      setPendingAlert(true);
      return;
    }
    void runAnalysis();
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">JSON Data Drift Analyzer</h1>
        <p className="text-sm text-slate-600">Upload baseline and latest exports to detect drift, quality failures, and document-level regressions.</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <label className="rounded border border-slate-300 bg-white p-4">
          <span className="text-sm font-medium">Baseline JSON</span>
          <input data-testid="baseline-input" className="mt-2 block w-full text-sm" type="file" accept="application/json" onChange={(event) => setBaselineFile(event.target.files?.[0] ?? null)} />
          {baselineFile ? <p className="mt-2 text-xs text-slate-600">{baselineFile.name} ({baselineFile.size} bytes)</p> : null}
        </label>
        <label className="rounded border border-slate-300 bg-white p-4">
          <span className="text-sm font-medium">Latest JSON</span>
          <input data-testid="latest-input" className="mt-2 block w-full text-sm" type="file" accept="application/json" onChange={(event) => setLatestFile(event.target.files?.[0] ?? null)} />
          {latestFile ? <p className="mt-2 text-xs text-slate-600">{latestFile.name} ({latestFile.size} bytes)</p> : null}
        </label>
      </section>
      {baselineFile && latestFile ? (
        <ExportDateIndicators baselineDates={baselineExportDates} latestDates={latestExportDates} issues={dateOrderingIssues} />
      ) : null}
      {dateOrderingIssues.length > 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="date-ordering-warning">
          Baseline Refreshed/Created dates should be older than the latest export. Review the highlighted dates before analyzing.
        </p>
      ) : null}
      <section className="grid gap-4 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Collection path</span>
          <input className="w-full rounded border border-slate-300 p-2" value={collectionPath} onChange={(event) => setCollectionPath(event.target.value)} placeholder="Export or $" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Identity fields (comma-separated)</span>
          <input className="w-full rounded border border-slate-300 p-2" value={identityKeys} onChange={(event) => setIdentityKeys(event.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Ignored fields</span>
          <input className="w-full rounded border border-slate-300 p-2" value={ignoredFields} onChange={(event) => setIgnoredFields(event.target.value)} />
        </label>
      </section>
      <div className="flex items-center gap-4">
        <button data-testid="analyze-button" className="rounded bg-sky-600 px-4 py-2 text-white disabled:bg-slate-400" disabled={disabled} onClick={onAnalyze}>
          Analyze
        </button>
        <div className="text-sm text-slate-600" aria-live="polite">{step ? `Progress: ${step}` : ""}</div>
      </div>
      {error ? <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {pendingAlert ? (
        <DateOrderingAlert
          baselineDates={baselineExportDates}
          issues={dateOrderingIssues}
          latestDates={latestExportDates}
          onCancel={() => setPendingAlert(false)}
          onContinue={() => {
            setPendingAlert(false);
            void runAnalysis();
          }}
        />
      ) : null}
    </main>
  );
}
