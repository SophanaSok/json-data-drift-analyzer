/**
 * Minimal Trello client.
 *
 * One operation: create a card. No board discovery, no attachments, no reads. The
 * narrower the surface, the less there is to get wrong with a bearer credential.
 *
 * Credentials travel in an `Authorization` header, never in the URL. Trello accepts
 * them as query parameters, but a URL is the one place a secret reliably leaks — into
 * history, referrers, proxy logs, and error strings.
 *
 * Nothing here retries. A POST that fails after leaving the browser may still have
 * created a card, and an automatic retry is exactly how one report becomes two; the
 * caller is told the outcome is unknown and decides what to do.
 *
 * Verified before this was written: api.trello.com answers a preflight for
 * POST /1/cards with `access-control-allow-origin: *` and allows the Authorization
 * header, so this works from a browser with no backend.
 */

const TRELLO_CARDS_URL = "https://api.trello.com/1/cards";
const DEFAULT_TIMEOUT_MS = 15_000;

export type TrelloCredentials = {
  /** Identifies the application. Not a secret on its own, but still user-entered. */
  apiKey: string;
  /** Bearer credential for the user's whole account. Never persisted by this app. */
  token: string;
};

export type TrelloCardInput = {
  listId: string;
  name: string;
  description: string;
  /** Trello label ids. Unmapped suggested labels are the caller's business, not sent. */
  labelIds?: string[];
};

export type TrelloErrorCategory =
  | "configuration"
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout";

export type TrelloPostResult =
  | { status: "created"; cardId: string; cardUrl: string }
  | {
      status: "failed";
      category: TrelloErrorCategory;
      message: string;
      /** The request definitively did not create a card. */
      cardCreated: "no";
    }
  | {
      status: "unknown";
      category: TrelloErrorCategory;
      message: string;
      /**
       * The request may have reached Trello. The caller must not retry
       * automatically, and must tell the user to check the board.
       */
      cardCreated: "unknown";
    };

/**
 * Strip credentials from anything that might be shown or stored.
 *
 * A last line of defence: no code path here deliberately includes a token in a
 * message, but an error string from `fetch` or a future change might.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join("[redacted]"), text);
}

function authorizationHeader(credentials: TrelloCredentials): string {
  return `OAuth oauth_consumer_key="${credentials.apiKey}", oauth_token="${credentials.token}"`;
}

function categorize(status: number): { category: TrelloErrorCategory; created: "no" | "unknown" } {
  if (status === 401) return { category: "unauthorized", created: "no" };
  if (status === 403) return { category: "forbidden", created: "no" };
  if (status === 429) return { category: "rate_limited", created: "no" };
  if (status >= 500) return { category: "server", created: "unknown" };
  return { category: "validation", created: "no" };
}

export type PostCardOptions = {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Create one card.
 *
 * @returns a discriminated outcome; this never throws for an API or network failure,
 *   because "unknown" is a real result the caller has to handle rather than an
 *   exception to swallow
 */
export async function postCard(
  input: TrelloCardInput,
  credentials: TrelloCredentials,
  options: PostCardOptions = {}
): Promise<TrelloPostResult> {
  const secrets = [credentials.token, credentials.apiKey];

  const missing = [
    credentials.apiKey.trim().length === 0 ? "API key" : null,
    credentials.token.trim().length === 0 ? "token" : null,
    input.listId.trim().length === 0 ? "list id" : null,
    input.name.trim().length === 0 ? "title" : null
  ].filter((value): value is string => value !== null);

  if (missing.length > 0) {
    return {
      status: "failed",
      category: "configuration",
      message: `Missing ${missing.join(", ")}.`,
      cardCreated: "no"
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(TRELLO_CARDS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        // Credentials here rather than in the query string.
        Authorization: authorizationHeader(credentials),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        idList: input.listId,
        name: input.name,
        desc: input.description,
        ...(input.labelIds && input.labelIds.length > 0 ? { idLabels: input.labelIds } : {})
      })
    });

    if (!response.ok) {
      const { category, created } = categorize(response.status);
      const body = await response.text().catch(() => "");
      const message = redactSecrets(
        `Trello returned ${response.status}${body ? `: ${body.slice(0, 300)}` : "."}`,
        secrets
      );
      return created === "unknown"
        ? { status: "unknown", category, message, cardCreated: "unknown" }
        : { status: "failed", category, message, cardCreated: "no" };
    }

    const card = (await response.json()) as { id?: string; shortUrl?: string; url?: string };
    if (!card.id) {
      // A 2xx with no id is not something to guess about.
      return {
        status: "unknown",
        category: "server",
        message: "Trello accepted the request but returned no card id.",
        cardCreated: "unknown"
      };
    }

    return { status: "created", cardId: card.id, cardUrl: card.shortUrl ?? card.url ?? "" };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const message = redactSecrets(
      error instanceof Error ? error.message : "The request failed before a response arrived.",
      secrets
    );

    // Both cases are ambiguous: the request may have reached Trello before the
    // connection or the clock gave out.
    return {
      status: "unknown",
      category: aborted ? "timeout" : "network",
      message: aborted ? `The request timed out. ${message}` : message,
      cardCreated: "unknown"
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** What each outcome means for the person looking at it. */
export function describeOutcome(result: TrelloPostResult): string {
  if (result.status === "created") return "Card created.";
  if (result.cardCreated === "no") {
    switch (result.category) {
      case "configuration":
        return "Nothing was sent: the configuration is incomplete.";
      case "unauthorized":
        return "No card was created: Trello rejected the token. It may have expired.";
      case "forbidden":
        return "No card was created: the token lacks write access to that list.";
      case "rate_limited":
        return "No card was created: Trello is rate limiting. Wait and try again.";
      default:
        return "No card was created: Trello rejected the request.";
    }
  }
  return "This may or may not have created a card. Check the board before trying again — retrying could post a duplicate.";
}
