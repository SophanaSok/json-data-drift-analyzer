import { create } from "zustand";
import { EMPTY_TICKET_FORM, type TicketDraftForm } from "../features/ticket/ticket-draft-view";

/**
 * Unrecorded, in-progress input: decision-form text and the optional ticket
 * context. Both used to live in component state, where a virtualization scroll
 * (which unmounts off-screen rows) or a tab switch (which unmounts the page)
 * silently discarded whatever the person had typed.
 *
 * Keys are caller-scoped to the analysis (`<generatedAt>|<cellId>` for decision
 * drafts, `generatedAt` for ticket forms), so a new analysis starts blank
 * instead of inheriting text meant for another run's cells.
 */

export type DecisionDraft = {
  open: boolean;
  reason: string;
  customValue: string;
  error: string | null;
};

export const EMPTY_DECISION_DRAFT: DecisionDraft = {
  open: false,
  reason: "",
  customValue: "",
  error: null
};

type DraftState = {
  decisionDrafts: Record<string, DecisionDraft>;
  updateDecisionDraft: (draftId: string, patch: Partial<DecisionDraft>) => void;
  clearDecisionDraft: (draftId: string) => void;
  ticketForms: Record<string, TicketDraftForm>;
  updateTicketForm: (formId: string, update: (current: TicketDraftForm) => TicketDraftForm) => void;
  reset: () => void;
};

export const useDraftStore = create<DraftState>((set) => ({
  decisionDrafts: {},
  updateDecisionDraft: (draftId, patch) =>
    set((state) => ({
      decisionDrafts: {
        ...state.decisionDrafts,
        [draftId]: { ...(state.decisionDrafts[draftId] ?? EMPTY_DECISION_DRAFT), ...patch }
      }
    })),
  clearDecisionDraft: (draftId) =>
    set((state) => {
      const { [draftId]: removed, ...rest } = state.decisionDrafts;
      void removed;
      return { decisionDrafts: rest };
    }),
  ticketForms: {},
  updateTicketForm: (formId, update) =>
    set((state) => ({
      ticketForms: {
        ...state.ticketForms,
        [formId]: update(state.ticketForms[formId] ?? EMPTY_TICKET_FORM)
      }
    })),
  reset: () => set({ decisionDrafts: {}, ticketForms: {} })
}));
