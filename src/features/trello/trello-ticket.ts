/**
 * Pure helpers for posting a ticket to Trello.
 *
 * The fingerprint, the duplicate check, and the record shape live here so they can be
 * tested without a network or a DOM. Nothing in this module holds a credential.
 */

import { hashText } from "../../lib/hash";
import type { TicketDraft } from "../../engine/ticketTemplate";
import type { RecoveryReview } from "../../engine/review";
import type { TrelloErrorCategory } from "../../lib/trello";

/** Persisted. Deliberately excludes the token. */
export type TrelloTarget = {
  id: "trello-target";
  apiKey: string;
  listId: string;
};

/**
 * One posting attempt, appended never updated.
 *
 * "Posted, failed, retried, succeeded" is a different history from "posted once", and
 * only the log distinguishes them — the same argument that governs the decision log.
 *
 * Carries no token, no API key, and no card body: the description's hash proves what
 * was sent without storing it a second time.
 */
export type PostedTicketRecord = {
  id: string;
  runFingerprint: string;
  analysisKey: string;
  status: "success" | "failed" | "unknown";
  profileId: string;
  profileVersion: number;
  sourceRun: string | null;
  referenceRun: string | null;
  title: string;
  descriptionSha256: string;
  severity: string;
  labelsSuggested: string[];
  listId: string;
  cardId: string | null;
  cardUrl: string | null;
  attemptedAt: string;
  actor: "user";
  errorCategory: TrelloErrorCategory | null;
  errorMessage: string | null;
};

/**
 * Identity of "this report for this run under this policy".
 *
 * Includes the input hashes so re-running against different files legitimately differs,
 * and the profile version so a report made under a superseded policy is a different
 * report rather than a duplicate.
 */
export async function runFingerprint(review: RecoveryReview, draft: TicketDraft): Promise<string> {
  const candidate = review.inputHashes.find((hash) => hash.role === "candidate")?.sha256 ?? "no-hash";
  const reference = review.inputHashes.find((hash) => hash.role === "reference")?.sha256 ?? "no-hash";
  const descriptionHash = await hashText(draft.markdownDescription);

  return hashText(
    [review.profileId, String(review.profileVersion), candidate, reference, draft.title, descriptionHash].join("::")
  );
}

export type DuplicateCheck =
  | { duplicate: false }
  | { duplicate: true; cardUrl: string | null; cardId: string | null; attemptedAt: string };

/**
 * Has this exact report already been posted successfully?
 *
 * Only a success blocks. A failed attempt created nothing, and an unknown one is
 * surfaced separately — it needs a human to check the board, not an automatic block.
 */
export function findExistingPost(records: PostedTicketRecord[], fingerprint: string): DuplicateCheck {
  const success = records.find(
    (record) => record.runFingerprint === fingerprint && record.status === "success"
  );
  if (!success) return { duplicate: false };
  return {
    duplicate: true,
    cardUrl: success.cardUrl,
    cardId: success.cardId,
    attemptedAt: success.attemptedAt
  };
}

/** Earlier attempts whose outcome was never established, newest first. */
export function unresolvedAttempts(records: PostedTicketRecord[], fingerprint: string): PostedTicketRecord[] {
  return records
    .filter((record) => record.runFingerprint === fingerprint && record.status === "unknown")
    .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt));
}

/**
 * Redact anything credential-shaped before a message is shown or stored.
 *
 * The client already redacts known secrets; this guards the values a user may have
 * pasted into a field by mistake, which the client never saw.
 */
export function containsCredentialShape(text: string): boolean {
  return /\b(?:oauth_token|api[_-]?key|bearer)\b/i.test(text);
}
