/**
 * Pure view model for the contractor ticket draft.
 *
 * The draft's content and safety rules live in src/engine/ticketTemplate.ts. This
 * module only turns what a person typed into that function's inputs, and reports
 * back what it refused and why.
 *
 * Nothing here performs a network call. Creating a Trello card is a network write
 * that needs its own user-facing confirmation step (AGENTS.md rule 11), and no
 * credential is read, stored, or accepted anywhere in this module (rule 9).
 */

import { buildTicketDraft, type TicketDraft, type TicketInput } from "../../engine/ticketTemplate";

export type IdentificationRow = { label: string; value: string };

export type TicketDraftForm = {
  /** Rows identifying the source and bot, as typed by the user. */
  identification: IdentificationRow[];
  /** Free text; one piece of supplied root-cause evidence per non-empty line. */
  rootCauseEvidence: string;
};

export const EMPTY_TICKET_FORM: TicketDraftForm = {
  identification: [],
  rootCauseEvidence: ""
};

/** Non-empty lines, trimmed. Blank input yields no evidence rather than one blank quote. */
export function parseEvidenceLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Rows with both halves filled. A half-typed row is dropped, not rendered blank. */
export function usableIdentification(rows: IdentificationRow[]): IdentificationRow[] {
  return rows
    .map((row) => ({ label: row.label.trim(), value: row.value.trim() }))
    .filter((row) => row.label.length > 0 && row.value.length > 0);
}

export type TicketDraftResult =
  | { ok: true; draft: TicketDraft }
  /** The template refused the input — a credential, or an unsupported root cause. */
  | { ok: false; error: string };

/**
 * Merge the form into the derived input and build the draft.
 *
 * The template throws rather than emitting something unsafe; that is surfaced to the
 * user as a refusal with the reason, not swallowed.
 */
export function buildDraftFromForm(baseInput: TicketInput, form: TicketDraftForm): TicketDraftResult {
  const identification = usableIdentification(form.identification);
  const evidence = parseEvidenceLines(form.rootCauseEvidence);

  const input: TicketInput = {
    ...baseInput,
    run: {
      ...baseInput.run,
      // Typed rows are added to whatever the run already knew, in that order.
      sourceIdentification: [...baseInput.run.sourceIdentification, ...identification]
    },
    suppliedRootCauseEvidence: evidence.length > 0 ? evidence : undefined
  };

  try {
    return { ok: true, draft: buildTicketDraft(input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not build the ticket draft." };
  }
}

/** What a person still has to do by hand, because this tool does not do it. */
export const TRELLO_HANDOFF_STEPS: string[] = [
  "Copy the title and description below into a new Trello card.",
  "Apply the suggested labels, or your board's equivalents.",
  "Attach the findings CSV, quality report, and recovery audit from the Recovery tab."
];
