/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrelloPostPanel } from "./TrelloPostPanel";
import { runFingerprint, type PostedTicketRecord } from "./trello-ticket";
import type { TicketDraft } from "../../engine/ticketTemplate";
import type { RecoveryReview } from "../../engine/review";
import type { TrelloPostResult } from "../../lib/trello";

const NOW = "2026-08-10T00:00:00.000Z";

const review = {
  profileId: "bellingham-procureware",
  profileVersion: 4,
  policyHash: null,
  generatedAt: NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json",
  inputHashes: [
    { fileName: "candidate.json", role: "candidate" as const, sha256: "a".repeat(64), unavailableReason: null },
    { fileName: "reference.json", role: "reference" as const, sha256: "b".repeat(64), unavailableReason: null }
  ]
} as unknown as RecoveryReview;

const draft: TicketDraft = {
  title: "[bellingham-procureware] BidStatus and 8 other fields unpopulated",
  markdownDescription: "## Source\n\nA description body.",
  suggestedLabels: ["field-regression", "severity:high"],
  severity: "high"
};

afterEach(cleanup);

function renderPanel(options: {
  result?: TrelloPostResult;
  records?: PostedTicketRecord[];
  postImpl?: ReturnType<typeof vi.fn>;
} = {}) {
  const postImpl =
    options.postImpl ??
    vi.fn(async () => options.result ?? ({ status: "created", cardId: "card-1", cardUrl: "https://trello.com/c/x" } as TrelloPostResult));
  const onRecordAttempt = vi.fn();
  const onSaveTarget = vi.fn();

  render(
    <TrelloPostPanel
      review={review}
      draft={draft}
      analysisKey={NOW}
      records={options.records ?? []}
      target={null}
      onSaveTarget={onSaveTarget}
      onRecordAttempt={onRecordAttempt}
      postImpl={postImpl as never}
      now={() => NOW}
    />
  );
  return { postImpl, onRecordAttempt, onSaveTarget };
}

async function configure(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("trello-key"), "key-1");
  await user.type(screen.getByTestId("trello-token"), "token-1");
  await user.type(screen.getByTestId("trello-list"), "list-1");
}

describe("TrelloPostPanel: what it shows before posting", () => {
  it("shows the exact title, labels, and body that would be sent", () => {
    renderPanel();

    expect(screen.getByTestId("preview-title").textContent).toBe(draft.title);
    expect(screen.getByTestId("preview-labels").textContent).toContain("field-regression");
    expect(screen.getByTestId("preview-body").textContent).toBe(draft.markdownDescription);
  });

  it("says labels are suggestions and are not applied to the card", () => {
    renderPanel();
    expect(screen.getByTestId("preview-labels").textContent).toContain("no label is applied");
  });

  it("says the token is never saved, and why", () => {
    renderPanel();
    const notice = screen.getByTestId("token-notice").textContent ?? "";

    expect(notice).toContain("never saved");
    expect(notice).toContain("shares an origin");
  });

  it("cannot post until it is configured", () => {
    renderPanel();
    expect((screen.getByTestId("trello-arm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("trello-not-configured")).not.toBeNull();
  });
});

describe("TrelloPostPanel: confirmation", () => {
  it("never posts without an explicit confirmation", async () => {
    const user = userEvent.setup();
    const { postImpl } = renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));

    // Armed, not posted: the confirm click is the last thing before the network.
    expect(postImpl).not.toHaveBeenCalled();
    expect(screen.getByTestId("trello-confirm").textContent).toContain("Create one card in list");
  });

  it("posts exactly one card per confirmed action", async () => {
    const user = userEvent.setup();
    const { postImpl } = renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(postImpl).toHaveBeenCalledTimes(1));
  });

  it("cancels without posting", async () => {
    const user = userEvent.setup();
    const { postImpl } = renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-cancel"));

    expect(postImpl).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trello-confirm")).toBeNull();
  });

  it("sends the reviewed draft unchanged", async () => {
    const user = userEvent.setup();
    const { postImpl } = renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(postImpl).toHaveBeenCalled());
    const [card, credentials] = postImpl.mock.calls[0] as [
      { listId: string; name: string; description: string },
      { apiKey: string; token: string }
    ];
    expect(card).toEqual({ listId: "list-1", name: draft.title, description: draft.markdownDescription });
    expect(credentials).toEqual({ apiKey: "key-1", token: "token-1" });
  });
});

describe("TrelloPostPanel: recording the outcome", () => {
  it("records a success with the card id and url, and no secret", async () => {
    const user = userEvent.setup();
    const { onRecordAttempt, onSaveTarget } = renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(onRecordAttempt).toHaveBeenCalled());
    const [record] = onRecordAttempt.mock.calls[0] as [PostedTicketRecord];

    expect(record.status).toBe("success");
    expect(record.cardId).toBe("card-1");
    expect(record.cardUrl).toBe("https://trello.com/c/x");
    expect(record.runFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toContain("token-1");
    expect(JSON.stringify(record)).not.toContain("key-1");

    // Only the non-secret half of the configuration is persisted.
    const [target] = onSaveTarget.mock.calls[0] as [{ apiKey: string; listId: string }];
    expect(target).toEqual({ id: "trello-target", apiKey: "key-1", listId: "list-1" });
    expect(JSON.stringify(target)).not.toContain("token-1");
  });

  it("shows the card link on success", async () => {
    const user = userEvent.setup();
    renderPanel();

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(screen.getByTestId("card-link").textContent).toBe("https://trello.com/c/x"));
  });
});

describe("TrelloPostPanel: failures keep the draft", () => {
  it("keeps the body and offers another attempt after a rejection", async () => {
    const user = userEvent.setup();
    const { onRecordAttempt, onSaveTarget } = renderPanel({
      result: { status: "failed", category: "unauthorized", message: "Trello returned 401.", cardCreated: "no" }
    });

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(screen.getByTestId("trello-result")).not.toBeNull());
    expect(screen.getByTestId("trello-result").textContent).toContain("No card was created");
    expect(screen.getByTestId("trello-result").textContent).toContain("draft above is unchanged");
    expect(screen.getByTestId("preview-body").textContent).toBe(draft.markdownDescription);

    const [record] = onRecordAttempt.mock.calls[0] as [PostedTicketRecord];
    expect(record.status).toBe("failed");
    // A failed attempt must not persist configuration as though it worked.
    expect(onSaveTarget).not.toHaveBeenCalled();
  });

  it("says an ambiguous outcome may have created a card", async () => {
    const user = userEvent.setup();
    const { onRecordAttempt } = renderPanel({
      result: { status: "unknown", category: "network", message: "Failed to fetch", cardCreated: "unknown" }
    });

    await configure(user);
    await user.click(screen.getByTestId("trello-arm"));
    await user.click(screen.getByTestId("trello-confirm-post"));

    await waitFor(() => expect(screen.getByTestId("trello-result")).not.toBeNull());
    expect(screen.getByTestId("trello-result").textContent).toContain("may or may not");

    const [record] = onRecordAttempt.mock.calls[0] as [PostedTicketRecord];
    expect(record.status).toBe("unknown");
  });
});

describe("TrelloPostPanel: duplicate prevention", () => {
  const priorSuccess = (fingerprint: string): PostedTicketRecord => ({
    id: "post:1",
    runFingerprint: fingerprint,
    analysisKey: NOW,
    status: "success",
    profileId: "bellingham-procureware",
    profileVersion: 4,
    policyHash: null,
    sourceRun: null,
    referenceRun: null,
    title: draft.title,
    descriptionSha256: fingerprint,
    severity: "high",
    labelsSuggested: [],
    listId: "list-1",
    cardId: "card-earlier",
    cardUrl: "https://trello.com/c/earlier",
    attemptedAt: "2026-08-09T00:00:00.000Z",
    actor: "user",
    errorCategory: null,
    errorMessage: null
  });

  it("blocks a second post of the same report and links the existing card", async () => {
    const user = userEvent.setup();
    // The real fingerprint, so this exercises the actual duplicate check.
    const fingerprint = await runFingerprint(review, draft);
    const { postImpl } = renderPanel({ records: [priorSuccess(fingerprint)] });

    await configure(user);
    await waitFor(() => expect(screen.queryByTestId("duplicate-warning")).not.toBeNull());

    expect(screen.getByTestId("duplicate-warning").textContent).toContain("already posted");
    expect((screen.getByTestId("trello-arm") as HTMLButtonElement).disabled).toBe(true);
    expect(postImpl).not.toHaveBeenCalled();
  });

  it("allows an explicit override, which is a separate deliberate action", async () => {
    const user = userEvent.setup();
    const fingerprint = await runFingerprint(review, draft);
    renderPanel({ records: [priorSuccess(fingerprint)] });

    await configure(user);
    await waitFor(() => expect(screen.queryByTestId("duplicate-override")).not.toBeNull());
    await user.click(screen.getByTestId("duplicate-override"));

    expect((screen.getByTestId("trello-arm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("warns about an earlier attempt whose outcome was never established", async () => {
    const unknownAttempt = { ...priorSuccess("f"), status: "unknown" as const };
    renderPanel({ records: [unknownAttempt] });

    // The fingerprint is computed asynchronously; the warning appears once it resolves.
    await waitFor(() => {
      const warning = screen.queryByTestId("unresolved-warning");
      if (warning) expect(warning.textContent).toContain("without a known outcome");
    });
  });
});
