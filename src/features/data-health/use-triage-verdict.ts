import { useMemo } from "react";
import { APP_VERSION } from "../../lib/build-info";
import { useUiStore } from "../../stores/ui-store";
import { useEffectiveProfile } from "../profiles/use-effective-profile";
import { alertFromFindings, buildDuplicateTitleTriage, buildTriageNote, type TriageVerdict } from "./triage";

export type TriageState = { verdict: TriageVerdict; note: string };

/**
 * Wire the current run and its governing policy into a duplicate-title verdict.
 *
 * The alert configuration is read from the effective profile so a clean run can
 * still say what threshold it was checked against, and falls back to the findings'
 * own evidence when the profile is no longer registered in this build.
 *
 * @returns null when there is no review to triage.
 */
export function useTriageVerdict(): TriageState | null {
  const review = useUiStore((state) => state.review);
  const { profile } = useEffectiveProfile(review?.profileId ?? null);

  return useMemo(() => {
    if (!review) return null;

    const findings = review.qa.findings;
    const alert = profile?.alerts?.duplicateTitle ?? alertFromFindings(findings);
    const verdict = buildDuplicateTitleTriage(findings, alert);
    const note = buildTriageNote(verdict, {
      profileLabel: profile?.displayName ?? review.profileId,
      profileVersion: review.profileVersion,
      policyHash: review.policyHash,
      sourceRun: review.sourceRun,
      referenceRun: review.referenceRun,
      appVersion: APP_VERSION
    });

    return { verdict, note };
  }, [review, profile]);
}
