import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DateOrderingAlert } from "../../components/upload/DateOrderingAlert";
import { ExportDateIndicators } from "../../components/upload/ExportDateIndicators";
import { ANALYSIS_CACHE_SCHEMA_VERSION, db, putAnalysisBounded } from "../../db";
import { ENGINE_SEMANTICS_VERSION } from "../../engine/version";
import { BELLINGHAM_PROCUREWARE, getProfile, listProfiles } from "../../profiles";
import { useEffectiveProfile } from "../profiles/use-effective-profile";
import { ProfilePicker } from "./ProfilePicker";
import { loadLastProfileId, saveLastProfileId } from "./last-profile";
import { hashText } from "../../lib/hash";
import { parseExport } from "../../lib/file-order";
import { assessFileOrder } from "../../engine/export-metadata";
import { PROFILES } from "../../profiles";
import { detectSourceProfile, type DetectionResult } from "../../profiles/detect";
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
  const [collectionPath, setCollectionPath] = useState(BELLINGHAM_PROCUREWARE.collectionPath);
  const [identityKeys, setIdentityKeys] = useState(BELLINGHAM_PROCUREWARE.quality.identityDefault.join(","));
  const [ignoredFields, setIgnoredFields] = useState("");
  // Set when the user edits a profile-derived input after the last profile
  // change; a customized value survives a re-render but not a profile switch.
  const [collectionPathCustomized, setCollectionPathCustomized] = useState(false);
  const [identityCustomized, setIdentityCustomized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAlert, setPendingAlert] = useState(false);
  const [running, setRunning] = useState(false);
  const step = useUiStore((state) => state.workerStep);
  const setStep = useUiStore((state) => state.setWorkerStep);
  const setAnalysis = useUiStore((state) => state.setAnalysis);
  const setReview = useUiStore((state) => state.setReview);
  // Last-used profile, validated against the registry: a stored id from a
  // removed profile falls back to the default rather than crashing.
  const [sourceProfileId, setSourceProfileId] = useState(() => {
    const stored = loadLastProfileId();
    return stored !== null && getProfile(stored) !== null ? stored : BELLINGHAM_PROCUREWARE.id;
  });
  const sourceProfile = getProfile(sourceProfileId) ?? BELLINGHAM_PROCUREWARE;
  const profileRows = useMemo(() => listProfiles(), []);
  // Where the current selection came from. Detection may replace a default or
  // persisted selection; it must never replace a person's (or its own,
  // subsequently reviewed) choice — it warns instead.
  const [selectionOrigin, setSelectionOrigin] = useState<"default" | "persisted" | "manual" | "detected">(
    () => (loadLastProfileId() !== null ? "persisted" : "default")
  );
  const [detection, setDetection] = useState<{ baseline: DetectionResult; latest: DetectionResult } | null>(null);
  const [mismatchDismissed, setMismatchDismissed] = useState(false);
  // Refs so the file-parse effect can read the CURRENT origin/selection
  // without re-parsing both files every time either changes.
  const selectionRef = useRef({ origin: selectionOrigin, profileId: sourceProfileId });
  selectionRef.current = { origin: selectionOrigin, profileId: sourceProfileId };
  // Resolved policy identity: base + delta + any local override. What the
  // worker receives and what the cache key pins. `loading` gates Analyze so a
  // run can never start under a policy whose override read has not settled.
  const {
    profile: resolvedProfileOrNull,
    overrideActive,
    overrideStale,
    loading: profileResolving
  } = useEffectiveProfile(sourceProfile.id);
  const resolvedProfile = resolvedProfileOrNull;
  const showToast = useToastStore((state) => state.showToast);
  const fileOrderAssessment = useUiStore((state) => state.fileOrderAssessment);
  const setFileOrderAssessment = useUiStore((state) => state.setFileOrderAssessment);
  // Includes `running`: a second Analyze while one is live would either interleave
  // two runs on one worker or be refused by the runner — disable it instead.
  const disabled = useMemo(
    () => !baselineFile || !latestFile || !fileOrderAssessment || running || profileResolving,
    [baselineFile, fileOrderAssessment, latestFile, running, profileResolving]
  );
  const dateOrderingIssues = fileOrderAssessment?.issues ?? [];
  const baselineExportDates = fileOrderAssessment?.baseline.dates ?? {};
  const latestExportDates = fileOrderAssessment?.latest.dates ?? {};

  // An abandoned run must not outlive the page: without this, a slow run started
  // here kept running after navigation and its stale closure could fire
  // setAnalysis + navigate('/results') minutes later, mid-configuration.
  useEffect(() => {
    return () => {
      runner.cancel();
    };
  }, []);

  // Derive the comparison inputs from the selected profile. Unconditional on a
  // profile switch — a manual edit surviving into a different source's analysis
  // is exactly the cross-source confusion to prevent; the badges below give a
  // deliberate edit an escape hatch instead.
  const applyProfileSelection = (id: string, origin: "manual" | "detected") => {
    const next = getProfile(id);
    if (!next) return;
    setSourceProfileId(id);
    setSelectionOrigin(origin);
    saveLastProfileId(id);
    setCollectionPath(next.collectionPath);
    setIdentityKeys(next.quality.identityDefault.join(","));
    setCollectionPathCustomized(false);
    setIdentityCustomized(false);
  };
  const selectProfile = (id: string) => applyProfileSelection(id, "manual");

  // Picking a different file abandons the run in flight — its result would
  // describe files the user has moved past, and the runner refusing "already
  // running" would otherwise block the new configuration.
  const abandonActiveRun = () => {
    if (runner.isRunning()) {
      runner.cancel();
      setRunning(false);
      setStep(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setFileOrderAssessment(null);
    setDetection(null);
    setMismatchDismissed(false);
    if (!baselineFile || !latestFile) return;

    void Promise.all([baselineFile.text(), latestFile.text()])
      .then(([baselineText, latestText]) => {
        if (cancelled) return;
        // Each file is parsed ONCE here and the parsed value feeds both the
        // file-order assessment and profile detection — strictly cheaper than
        // the previous parse-inside-assess, which detection would have doubled.
        const baselineParsed = parseExport(baselineText);
        const latestParsed = parseExport(latestText);
        setFileOrderAssessment(
          assessFileOrder(baselineParsed, latestParsed, baselineFile.name, latestFile.name, collectionPath)
        );

        const registered = Object.values(PROFILES);
        const baselineDetection = detectSourceProfile(baselineParsed, registered);
        const latestDetection = detectSourceProfile(latestParsed, registered);
        setDetection({ baseline: baselineDetection, latest: latestDetection });

        // Auto-select only over a default or persisted selection. A manual
        // choice — or a previous detection the user has had a chance to see —
        // is never silently replaced; the mismatch notice below warns instead.
        const { origin } = selectionRef.current;
        if (baselineDetection.status === "match" && (origin === "default" || origin === "persisted")) {
          applyProfileSelection(baselineDetection.match.profileId, "detected");
        }
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
    if (!baselineFile || !latestFile || !resolvedProfile) return;
    setError(null);
    try {
      const baselineText = await baselineFile.text();
      const latestText = await latestFile.text();
      // The file-order assessment already in the store was computed from these same
      // files when they were selected (the Analyze button is disabled until it
      // exists). Recomputing it here parsed both files a second time on the main
      // thread — pure jank at large file sizes.
      const identityFields = parseCsvInput(identityKeys);
      const ignored = parseCsvInput(ignoredFields);
      const analysisKey = await hashText(
        [
          await hashText(baselineText),
          await hashText(latestText),
          collectionPath,
          identityFields.join("|"),
          ignored.join("|"),
          // The policy hash pins the full resolved policy — base + delta +
          // any local override, quality section included — so ANY policy
          // change invalidates the cache rather than reusing the previous
          // policy's outcome. (It subsumes the old defaultProfile and
          // version entries.)
          resolvedProfile.id,
          resolvedProfile.policyHash,
          // A cached entry written under an older persisted shape must be a cache
          // miss, not a review missing fields the current code assumes exist.
          String(ANALYSIS_CACHE_SCHEMA_VERSION),
          // An engine BEHAVIOR fix (same shape, different results) must also be a
          // cache miss — otherwise stale wrong results are served indefinitely.
          String(ENGINE_SEMANTICS_VERSION)
        ].join("::")
      );

      // The cache is an optimization, never a requirement: a failing IndexedDB
      // (private browsing, corrupted DB) must degrade to a cache miss, not block
      // the analysis — every other db call in this file already degrades this way.
      const cached = await db.analyses.get(analysisKey).catch(() => undefined);
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
            profileId: resolvedProfile.id
          },
          sourceProfile: resolvedProfile
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
            // cached under a different run's key. Bounded: old entries are pruned
            // and quota exhaustion evicts-then-retries instead of failing forever.
            await putAnalysisBounded({
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
              abandonActiveRun();
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
              abandonActiveRun();
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
          <input
            className="w-full rounded border border-slate-300 p-2"
            value={collectionPath}
            onChange={(event) => {
              setCollectionPath(event.target.value);
              setCollectionPathCustomized(event.target.value !== sourceProfile.collectionPath);
            }}
            placeholder="Export or $"
          />
          {collectionPathCustomized ? (
            <span className="mt-1 block text-xs text-amber-700" data-testid="collection-path-customized">
              Edited — differs from the profile ({sourceProfile.collectionPath}). Drift comparison will read “
              {collectionPath}”, but recovery always reads the profile's path.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCollectionPath(sourceProfile.collectionPath);
                  setCollectionPathCustomized(false);
                }}
              >
                Reset to profile
              </button>
            </span>
          ) : null}
        </label>
        <div className="block text-sm">
          <span className="font-medium">Source profile</span>
          <ProfilePicker
            profiles={profileRows}
            value={sourceProfileId}
            onChange={selectProfile}
            overriddenIds={overrideActive ? new Set([sourceProfile.id]) : undefined}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Governs recovery: which fields may be backfilled, how records are matched, and when an
            export is blocked. Approved fields:{" "}
            {(resolvedProfile ?? sourceProfile).safeBackfillFields.length > 0
              ? (resolvedProfile ?? sourceProfile).safeBackfillFields.join(", ")
              : "none"}.
          </span>
          {overrideActive && resolvedProfile ? (
            <span
              data-testid="profile-override-badge"
              className="mt-1 block rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
            >
              Local override active: this analysis will run under repo v{sourceProfile.version} + override rev{" "}
              {resolvedProfile.overrideRevision} (policy {resolvedProfile.policyHash.slice(0, 8)}…), not the
              unmodified repo policy.
            </span>
          ) : null}
          {overrideStale ? (
            <span
              data-testid="profile-override-stale"
              className="mt-1 block rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
            >
              A local override exists for this profile but was written against an older repo version and was NOT
              applied. Review it on the Profiles page.
            </span>
          ) : null}
          {detection?.baseline.status === "match" &&
          detection.baseline.match.profileId === sourceProfileId &&
          selectionOrigin === "detected" ? (
            <span
              data-testid="profile-detection-notice"
              className="mt-1 block rounded border border-sky-300 bg-sky-50 p-2 text-xs text-sky-800"
            >
              Detected from the uploaded file ({detection.baseline.match.matchedField} starts with{" "}
              {detection.baseline.match.matchedPrefix}). Not this source? Pick another profile above.
            </span>
          ) : null}
          {detection?.baseline.status === "match" &&
          detection.baseline.match.profileId !== sourceProfileId &&
          !mismatchDismissed ? (
            <span
              data-testid="profile-detection-mismatch"
              className="mt-1 block rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
            >
              This file looks like{" "}
              <strong>{PROFILES[detection.baseline.match.profileId]?.displayName ?? detection.baseline.match.profileId}</strong>{" "}
              ({detection.baseline.match.matchedField} starts with {detection.baseline.match.matchedPrefix}), but{" "}
              <strong>{sourceProfile.displayName ?? sourceProfile.id}</strong> is selected.{" "}
              <button
                type="button"
                className="underline"
                data-testid="use-detected-profile"
                onClick={() => {
                  const detected = detection.baseline;
                  if (detected.status === "match") applyProfileSelection(detected.match.profileId, "detected");
                }}
              >
                Use {PROFILES[detection.baseline.match.profileId]?.displayName ?? detection.baseline.match.profileId}
              </button>{" "}
              ·{" "}
              <button type="button" className="underline" onClick={() => setMismatchDismissed(true)}>
                Keep {sourceProfile.displayName ?? sourceProfile.id}
              </button>
            </span>
          ) : null}
          {detection?.baseline.status === "ambiguous" ? (
            <span
              data-testid="profile-detection-ambiguous"
              className="mt-1 block rounded border border-slate-300 bg-slate-50 p-2 text-xs text-slate-600"
            >
              The uploaded file matches more than one profile (
              {detection.baseline.matches.map((match) => match.profileId).join(", ")}) — their detection prefixes
              overlap. Pick the right one manually.
            </span>
          ) : null}
          {detection?.baseline.status === "match" &&
          detection.latest.status === "match" &&
          detection.baseline.match.profileId !== detection.latest.match.profileId ? (
            <span
              data-testid="profile-detection-cross-source"
              className="mt-1 block rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700"
            >
              The two files look like different sources: baseline matches{" "}
              {detection.baseline.match.profileId}, latest matches {detection.latest.match.profileId}. Comparing
              them would be cross-source drift, which no profile governs.
            </span>
          ) : null}
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Identity fields (comma-separated)</span>
          <input
            className="w-full rounded border border-slate-300 p-2"
            value={identityKeys}
            onChange={(event) => {
              setIdentityKeys(event.target.value);
              setIdentityCustomized(event.target.value !== sourceProfile.quality.identityDefault.join(","));
            }}
          />
          {identityCustomized ? (
            <span className="mt-1 block text-xs text-amber-700" data-testid="identity-customized">
              Edited — differs from the profile ({sourceProfile.quality.identityDefault.join(",")}).{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setIdentityKeys(sourceProfile.quality.identityDefault.join(","));
                  setIdentityCustomized(false);
                }}
              >
                Reset to profile
              </button>
            </span>
          ) : null}
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
