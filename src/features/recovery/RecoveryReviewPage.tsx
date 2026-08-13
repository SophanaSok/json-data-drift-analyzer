import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildSummaryTiles,
  changedRecords,
  groupBackfillsByField,
  groupExclusions,
  withheldFields
} from "./recovery-review-table";
import { FindingsExplorer } from "./FindingsExplorer";
import { RecordInspector } from "./RecordInspector";
import { DecisionQueue } from "./DecisionQueue";
import { buildExportBundle, downloadArtifact, type ExportArtifact } from "../../engine/export";
import { applyOverridesToRecovery, type OverrideApplication } from "../../engine/recovery";
import { useEffectiveProfile } from "../profiles/use-effective-profile";
import { useUiStore } from "../../stores/ui-store";
import {
  backfilledCellIds,
  classifyCells,
  countLanes,
  decisionsToOverrides,
  resolveDecisions
} from "../../engine/decisions";
import { useToastStore } from "../../stores/toast-store";
import { useDecisionLog } from "./use-decision-log";

const TONE_CLASS = {
  neutral: "text-slate-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700"
} as const;

export function RecoveryReviewPage() {
  const review = useUiStore((state) => state.review);
  const showToast = useToastStore((state) => state.showToast);
  const [openRecordKey, setOpenRecordKey] = useState<string | null>(null);
  const { log: decisionLog, record: onRecordDecisions } = useDecisionLog(review);
  // The effective profile: repo policy plus any local override, policy-stamped.
  // The review carries only the identity of the policy it ran under. Until the
  // override read settles this holds the repo-only resolution; the memo below
  // recomputes when it refines, so the staleness verdict is momentarily
  // conservative rather than the page being blank.
  const { profile: effectiveProfile } = useEffectiveProfile(review?.profileId ?? null);

  const model = useMemo(() => {
    if (!review) return null;

    // A version OR resolved-policy mismatch means this review was produced
    // under a different policy — surfaced rather than papered over, because
    // the export gate reads the profile. The hash catches what the version
    // cannot: a local override applied or removed since the run.
    const profile = effectiveProfile;
    const staleUnderProfile =
      profile !== null &&
      (profile.version !== review.profileVersion ||
        (review.policyHash !== null && profile.policyHash !== review.policyHash));

    // Decisions in force are applied to the recovery result the exports are built
    // from, so the artifact and the decision log cannot silently disagree. A stale
    // profile blocks application: the decisions were resolved under a policy the
    // current profile no longer describes.
    // The auto-cell set makes a keep_candidate on an applied backfill a real
    // override (a veto writes the candidate value back); on review-lane cells
    // it stays a log-only entry, as before.
    const overrides = decisionsToOverrides(resolveDecisions(decisionLog), backfilledCellIds(review));
    let application: OverrideApplication | null = null;
    if (profile && !staleUnderProfile && overrides.length > 0) {
      application = applyOverridesToRecovery(review.recovery, overrides, profile);
    }
    const recovery = application?.recovery ?? review.recovery;

    // What the gate's verdict does NOT cover: cells still awaiting review, and
    // fields lost systemically. "Passes the gate" must not read as "clean data".
    const reviewLaneCount = profile ? countLanes(classifyCells(review, profile)).review : 0;
    const systemicFields = review.qa.findings
      .filter((finding) => finding.category === "systemic_field_regression" && finding.fieldPath !== null)
      .map((finding) => finding.fieldPath as string);

    return {
      profile,
      staleUnderProfile,
      reviewLaneCount,
      systemicFields,
      tiles: buildSummaryTiles(review),
      backfills: groupBackfillsByField(review),
      withheld: withheldFields(review),
      exclusions: groupExclusions(review),
      records: changedRecords(review),
      recoverableFields: review.recovery.summary.backfillableFields,
      overrideCount: overrides.length,
      application,
      bundle: profile
        ? buildExportBundle({
            profile,
            qa: review.qa,
            recovery,
            dedupe: review.dedupe,
            generatedAt: review.generatedAt,
            inputHashes: review.inputHashes,
            sourceRun: review.sourceRun,
            referenceRun: review.referenceRun
          })
        : null
    };
  }, [review, decisionLog, effectiveProfile]);

  if (!review || !model) {
    return (
      <div className="space-y-3 p-6">
        <h2 className="text-xl font-semibold">Recovery review</h2>
        <p className="text-sm text-slate-600">
          No recovery review for this run. Run an analysis with a configured source profile.
        </p>
        <Link className="text-sm text-sky-700 underline" to="/">
          Start a new analysis
        </Link>
      </div>
    );
  }

  const onDownload = (artifact: ExportArtifact) => {
    if (!downloadArtifact(artifact)) {
      showToast(`Could not start the download for ${artifact.fileName}.`, "warning");
    }
  };

  return (
    <div className="space-y-6 p-6" data-testid="recovery-review">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Recovery review</h2>
        <p className="text-sm text-slate-600">
          What recovery <strong>would</strong> do. Nothing here changes your source files. Decisions
          you record in the review queue are saved in this browser and applied to the exported
          artifacts below.
        </p>
        <p className="text-xs text-slate-500">
          Profile <code className="rounded bg-slate-100 px-1">{review.profileId}</code> v
          {review.profileVersion}
          {review.overrideRevision > 0 ? (
            <span className="text-amber-700" data-testid="review-override-marker">
              {" "}
              + local override rev {review.overrideRevision}
            </span>
          ) : null}
          {review.policyHash ? <> · policy {review.policyHash.slice(0, 8)}…</> : null} · candidate{" "}
          {review.sourceRun ?? "(unnamed)"} · reference {review.referenceRun ?? "(unnamed)"} · generated{" "}
          {review.generatedAt}
        </p>
      </header>

      {model.bundle ? (
        model.bundle.gate.recoveredExportAllowed ? (
          // States what the gate actually checked, plus what it does NOT vouch for.
          // "Passes the gate" is not "clean data": cells awaiting review stay
          // unrecovered, and a systemic loss is named rather than averaged away.
          <p
            className="rounded border-2 border-emerald-500 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900"
            data-testid="export-state"
            data-state="safe"
          >
            ✓ Export permitted — the match rate meets the profile minimum and no critical findings
            are open.
            {model.reviewLaneCount > 0
              ? ` ${model.reviewLaneCount} cell(s) still await manual review and are not recovered automatically.`
              : ""}
          </p>
        ) : (
          <p
            className="rounded border-2 border-red-600 bg-red-50 p-3 text-sm font-semibold text-red-900"
            data-testid="export-state"
            data-state="blocked"
          >
            ✕ Export blocked — the recovered data artifact is withheld.{" "}
            {model.bundle.gate.blockingReasons.join(" ")} Reports and audits remain available.
          </p>
        )
      ) : null}

      {model.systemicFields.length > 0 ? (
        <p
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          data-testid="systemic-regression-warning"
        >
          Systemic regression: {model.systemicFields.join(", ")} — lost in every matched record
          where the reference held a value. This is the signature of a broken extraction routine;
          the primary remedy is a fixed scraper re-run.
        </p>
      ) : null}

      <section className="grid gap-3 md:grid-cols-5" data-testid="review-summary">
        {model.tiles.map((tile) => (
          <div key={tile.id} className="rounded border bg-white p-3">
            <p className="text-xs text-slate-500">{tile.label}</p>
            <p className={`text-lg font-semibold ${TONE_CLASS[tile.tone]}`}>{tile.value}</p>
            {tile.detail ? <p className="text-xs text-slate-500">{tile.detail}</p> : null}
          </div>
        ))}
      </section>

      {model.staleUnderProfile ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="stale-review">
          {model.profile?.version !== review.profileVersion
            ? `This review was produced under profile v${review.profileVersion}, but the profile is now v${model.profile?.version}.`
            : "This review was produced under a different resolved policy than the current one — a local profile override was applied or removed since the run."}{" "}
          Re-run the analysis so the review reflects the current policy.
        </p>
      ) : null}

      {review.inputHashes.some((hash) => hash.sha256 === null) ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Input hashes unavailable — this run cannot prove which files it read.{" "}
          {review.inputHashes.find((hash) => hash.unavailableReason)?.unavailableReason}
        </p>
      ) : null}

      <section className="rounded border bg-white p-4" data-testid="recoverable-fields">
        <h3 className="font-medium">Recoverable fields</h3>
        <p className="mt-1 text-sm text-slate-600">
          {model.recoverableFields.length > 0
            ? `Approved for automatic backfill under this profile: ${model.recoverableFields.join(", ")}.`
            : "No field is approved for automatic backfill under this profile."}
        </p>
      </section>

      {model.profile ? (
        <DecisionQueue
          review={review}
          profile={model.profile}
          log={decisionLog}
          onRecord={onRecordDecisions}
          now={() => new Date().toISOString()}
        />
      ) : null}

      <FindingsExplorer findings={review.qa.findings} />

      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Proposed changes by field</h3>
        <p className="mt-1 text-xs text-slate-500">
          Only fields the source profile approves are listed. Every value comes from the matched
          reference record and is recorded as <code>reference_backfill</code>.
        </p>
        {model.backfills.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600" data-testid="no-backfills">
            No field is approved for automatic backfill, so recovery would change nothing.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">Field</th>
                <th className="py-1">Records</th>
                <th className="py-1">Distinct values</th>
                <th className="py-1">Sample</th>
              </tr>
            </thead>
            <tbody>
              {model.backfills.map((group) => (
                <tr key={group.field} className="border-t align-top" data-testid={`backfill-${group.field}`}>
                  <td className="py-2 font-medium">{group.field}</td>
                  <td className="py-2">{group.count}</td>
                  <td className="py-2">{group.distinctValueCount}</td>
                  <td className="py-2 text-slate-600">
                    {group.sampleValues.map((value) => truncate(value)).join(" · ")}
                    {group.distinctValueCount > group.sampleValues.length
                      ? ` … +${group.distinctValueCount - group.sampleValues.length} more`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {model.withheld.length > 0 ? (
        <section className="rounded border bg-white p-4" data-testid="withheld-fields">
          <h3 className="font-medium">Withheld by policy</h3>
          <p className="mt-1 text-sm text-slate-600">
            These fields are date- or state-sensitive. They stay unrecovered until approved
            explicitly for this source: {model.withheld.join(", ")}.
          </p>
        </section>
      ) : null}

      {model.exclusions.length > 0 ? (
        <section className="rounded border bg-white p-4" data-testid="exclusions">
          <h3 className="font-medium">Excluded records</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {model.exclusions.map((group) => (
              <li key={group.reason}>
                <span className="font-medium">{group.reason.replace(/_/g, " ")}</span> — {group.count}{" "}
                record(s)
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                  {group.examples.map((example) => (
                    <li key={`${group.reason}-${example.candidateIndex}`}>{example.detail}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Records that would change ({model.records.length})</h3>
        {model.records.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No record would change.</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {model.records.slice(0, 100).map((record) => (
              <li key={record.recordKey} className="py-2">
                <button
                  className="text-left text-sky-700 hover:underline"
                  data-testid={`record-toggle-${record.candidateIndex}`}
                  onClick={() =>
                    setOpenRecordKey(openRecordKey === record.recordKey ? null : record.recordKey)
                  }
                >
                  #{record.candidateIndex} — {record.changedFieldCount} field(s):{" "}
                  {record.fields.join(", ")}
                </button>
                {openRecordKey === record.recordKey ? (
                  <RecordInspector review={review} recordKey={record.recordKey} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {model.records.length > 100 ? (
          <p className="mt-2 text-xs text-slate-500">
            Showing the first 100 of {model.records.length}. The full set is in the exported audit.
          </p>
        ) : null}
      </section>

      <section className="rounded border bg-white p-4" data-testid="export-section">
        <h3 className="font-medium">Export</h3>
        <p className="mt-1 text-xs text-slate-500">
          Files download to this browser. Nothing is uploaded and no external system is contacted.
        </p>
        {model.application ? (
          <p className="mt-2 text-xs text-emerald-800" data-testid="decisions-applied">
            {model.application.appliedCount} recorded decision(s) applied to the recovered artifact;
            each is logged as <code>manual_override</code> in the recovery audit.
          </p>
        ) : null}
        {model.application && model.application.unapplied.length > 0 ? (
          <div
            className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            data-testid="decisions-unapplied"
          >
            <p className="font-medium">
              {model.application.unapplied.length} decision(s) could NOT be applied and are not in the
              exported artifact:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {model.application.unapplied.slice(0, 10).map((entry) => (
                <li key={`${entry.override.recordKey}-${entry.override.field}`}>
                  <code>{entry.override.field}</code> — {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {model.staleUnderProfile && model.overrideCount > 0 ? (
          <p
            className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            data-testid="decisions-stale"
          >
            {model.overrideCount} recorded decision(s) are NOT applied to these artifacts: they were
            resolved under profile v{review.profileVersion}, which is no longer current. Re-run the
            analysis.
          </p>
        ) : null}
        {model.bundle === null ? (
          <p className="mt-2 text-sm text-slate-600" data-testid="export-unavailable">
            Profile <code>{review.profileId}</code> is not registered in this build, so artifacts
            cannot be built.
          </p>
        ) : null}
        {model.bundle && model.bundle.blocked.length > 0 ? (
          <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900" data-testid="export-blocked">
            Recovered data export is blocked: {model.bundle.blocked.map((item) => item.reason).join(" ")}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {(model.bundle?.artifacts ?? []).map((artifact) => (
            <button
              key={artifact.kind}
              className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
              data-testid={`download-${artifact.kind}`}
              onClick={() => onDownload(artifact)}
            >
              {artifact.fileName}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function truncate(value: string, limit = 60): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

