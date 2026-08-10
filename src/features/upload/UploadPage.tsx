import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DateOrderingAlert } from "../../components/upload/DateOrderingAlert";
import { ExportDateIndicators } from "../../components/upload/ExportDateIndicators";
import { ANALYSIS_CACHE_SCHEMA_VERSION, db } from "../../db";
import { defaultProfile } from "../../engine/profile";
import { BELLINGHAM_PROCUREWARE, PROFILES, getProfile } from "../../profiles";
import { hashText } from "../../lib/hash";
import { assessFileOrderFromJson } from "../../lib/file-order";
import { useUiStore } from "../../stores/ui-store";
import { useToastStore } from "../../stores/toast-store";
import { createAnalysisRunner } from "./analysis-runner";
import type { AnalyzeRequest } from "../../workers/protocol";

const worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), { type: "module" });
// Owns request/response correlation: every worker message is dispatched by the
// analysisKey it echoes, so a result can never be handled — or cached — under a
// different run's key.
const runner = createAnalysisRunner(worker);

function parseCsvInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function UploadPage() {
  const navigate = useNavigate();
  const [baselineFile, setBaselineFile] = useState<File | null>(null);
  const [latestFile, setLatestFile] = useState<File | null>(null);
  const [collectionPath, setCollectionPath] = useState("Export");
  const [identityKeys, setIdentityKeys] = useState(defaultProfile.identityDefault.join(","));
  const [ignoredFields, setIgnoredFields] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAlert, setPendingAlert] = useState(false);
  const [running, setRunning] = useState(false);
  const step = useUiStore((state) => state.workerStep);
  const setStep = useUiStore((state) => state.setWorkerStep);
  const setAnalysis = useUiStore((state) => state.setAnalysis);
  const setReview = useUiStore((state) => state.setReview);
  const [sourceProfileId, setSourceProfileId] = useState(BELLINGHAM_PROCUREWARE.id);
  // Falls back rather than crashing if a stored id ever names an unregistered profile.
  const sourceProfile = getProfile(sourceProfileId) ?? BELLINGHAM_PROCUREWARE;
  const showToast = useToastStore((state) => state.showToast);
  const fileOrderAssessment = useUiStore((state) => state.fileOrderAssessment);
  const setFileOrderAssessment = useUiStore((state) => state.setFileOrderAssessment);
  // Includes `running`: a second Analyze while one is live would either interleave
  // two runs on one worker or be refused by the runner — disable it instead.
  const disabled = useMemo(
    () => !baselineFile || !latestFile || !fileOrderAssessment || running,
    [baselineFile, fileOrderAssessment, latestFile, running]
  );
  const dateOrderingIssues = fileOrderAssessment?.issues ?? [];
  const baselineExportDates = fileOrderAssessment?.baseline.dates ?? {};
  const latestExportDates = fileOrderAssessment?.latest.dates ?? {};

  useEffect(() => {
    let cancelled = false;
    setFileOrderAssessment(null);
    if (!baselineFile || !latestFile) return;

    void Promise.all([baselineFile.text(), latestFile.text()])
      .then(([baselineText, latestText]) => {
        if (cancelled) return;
        setFileOrderAssessment(
          assessFileOrderFromJson(
            baselineText,
            latestText,
            baselineFile.name,
            latestFile.name,
            collectionPath
          )
        );
      })
      .catch(() => {
        if (!cancelled) {
          setFileOrderAssessment(null);
          setError("Could not read export dates because one of the selected files is not valid JSON.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [baselineFile, collectionPath, latestFile, setFileOrderAssessment]);

  const runAnalysis = async () => {
    if (!baselineFile || !latestFile) return;
    setError(null);
    try {
      const baselineText = await baselineFile.text();
      const latestText = await latestFile.text();
      const assessment = assessFileOrderFromJson(
        baselineText,
        latestText,
        baselineFile.name,
        latestFile.name,
        collectionPath
      );
      setFileOrderAssessment(assessment);
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
          String(defaultProfile.version),
          // Approving a field bumps the source profile version, which must
          // invalidate the cache rather than reuse the previous policy's outcome.
          sourceProfile.id,
          String(sourceProfile.version),
          // A cached entry written under an older persisted shape must be a cache
          // miss, not a review missing fields the current code assumes exist.
          String(ANALYSIS_CACHE_SCHEMA_VERSION)
        ].join("::")
      );

      const cached = await db.analyses.get(analysisKey);
      if (cached) {
        setAnalysis(cached.result);
        setReview(cached.review ?? null);
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
          profile: defaultProfile,
          sourceProfileId: sourceProfile.id
        }
      };

      const started = runner.start(request, {
        onProgress: setStep,
        onError: (message) => {
          setRunning(false);
          setError(message);
        },
        onResult: async (payload) => {
          setRunning(false);
          setStep("Ready");
          const { analysis, review } = payload;
          setAnalysis(analysis);
          setReview(review);
          try {
            // Keyed by the analysisKey the worker ECHOED, which the runner guarantees
            // is the one this request was started with — a result can never be
            // cached under a different run's key.
            await db.analyses.put({
              analysisKey: payload.analysisKey,
              createdAt: new Date().toISOString(),
              result: analysis,
              review
            });
          } catch {
            showToast("Result saved in this session but not cached in browser storage.", "warning");
          }
          navigate(`/results?tab=${analysis.qualityIssues.some((issue) => ["critical", "high"].includes(issue.severity)) ? "overview" : "records"}`);
        }
      });
      if (!started) {
        setError("An analysis is already running. Wait for it to finish.");
        return;
      }
      setRunning(true);
    } catch (analysisError) {
      setRunning(false);
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
          <input
            data-testid="baseline-input"
            className="mt-2 block w-full text-sm"
            type="file"
            accept="application/json"
            onChange={(event) => {
              setError(null);
              setFileOrderAssessment(null);
              setBaselineFile(event.target.files?.[0] ?? null);
            }}
          />
          {baselineFile ? <p className="mt-2 text-xs text-slate-600">{baselineFile.name} ({baselineFile.size} bytes)</p> : null}
        </label>
        <label className="rounded border border-slate-300 bg-white p-4">
          <span className="text-sm font-medium">Latest JSON</span>
          <input
            data-testid="latest-input"
            className="mt-2 block w-full text-sm"
            type="file"
            accept="application/json"
            onChange={(event) => {
              setError(null);
              setFileOrderAssessment(null);
              setLatestFile(event.target.files?.[0] ?? null);
            }}
          />
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
        <label className="block text-sm">
          <span className="font-medium">Source profile</span>
          <select
            className="mt-1 w-full rounded border border-slate-300 p-2"
            data-testid="source-profile-select"
            value={sourceProfileId}
            onChange={(event) => setSourceProfileId(event.target.value)}
          >
            {Object.values(PROFILES).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id} (v{profile.version})
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Governs recovery: which fields may be backfilled, how records are matched, and when an
            export is blocked. Approved fields:{" "}
            {sourceProfile.safeBackfillFields.length > 0 ? sourceProfile.safeBackfillFields.join(", ") : "none"}.
          </span>
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
