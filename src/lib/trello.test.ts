import { describe, expect, it, vi } from "vitest";
import { describeOutcome, postCard, redactSecrets } from "./trello";

const CREDENTIALS = { apiKey: "key-123", token: "token-abcdef" };
const CARD = { listId: "list-1", name: "Ticket title", description: "# Body" };

/** A fetch that never touches the network. */
function mockFetch(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.jsonBody ?? {},
      text: async () => response.textBody ?? ""
    }) as unknown as Response
  );
}

describe("postCard: success", () => {
  it("returns the card id and url", async () => {
    const fetchImpl = mockFetch({ jsonBody: { id: "card-1", shortUrl: "https://trello.com/c/abc" } });
    const result = await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ status: "created", cardId: "card-1", cardUrl: "https://trello.com/c/abc" });
  });

  it("sends credentials in the Authorization header, never in the URL", async () => {
    const fetchImpl = mockFetch({ jsonBody: { id: "card-1", shortUrl: "u" } });
    await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0];
    const headers = (init ?? {}).headers as Record<string, string>;

    expect(url).toBe("https://api.trello.com/1/cards");
    expect(url).not.toContain("token");
    expect(url).not.toContain(CREDENTIALS.token);
    expect(headers.Authorization).toContain(CREDENTIALS.token);
  });

  it("sends the card fields in the body", async () => {
    const fetchImpl = mockFetch({ jsonBody: { id: "c", shortUrl: "u" } });
    await postCard({ ...CARD, labelIds: ["label-1"] }, CREDENTIALS, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      idList: "list-1",
      name: "Ticket title",
      desc: "# Body",
      idLabels: ["label-1"]
    });
  });

  it("omits labels entirely when there are none", async () => {
    const fetchImpl = mockFetch({ jsonBody: { id: "c", shortUrl: "u" } });
    await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).not.toHaveProperty("idLabels");
  });

  it("posts exactly once per call", async () => {
    const fetchImpl = mockFetch({ jsonBody: { id: "c", shortUrl: "u" } });
    await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("postCard: configuration", () => {
  it("sends nothing when a field is missing", async () => {
    const fetchImpl = mockFetch({});
    const result = await postCard({ ...CARD, listId: "  " }, CREDENTIALS, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result).toMatchObject({ status: "failed", category: "configuration", cardCreated: "no" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names every missing field", async () => {
    const result = await postCard({ ...CARD, listId: "" }, { apiKey: "", token: "" }, {
      fetchImpl: mockFetch({}) as unknown as typeof fetch
    });

    if (result.status === "created") throw new Error("unexpected");
    expect(result.message).toContain("API key");
    expect(result.message).toContain("token");
    expect(result.message).toContain("list id");
  });
});

describe("postCard: failures that definitely created nothing", () => {
  const cases = [
    { status: 401, category: "unauthorized" },
    { status: 403, category: "forbidden" },
    { status: 400, category: "validation" },
    { status: 429, category: "rate_limited" }
  ] as const;

  for (const { status, category } of cases) {
    it(`treats ${status} as ${category} with no card created`, async () => {
      const result = await postCard(CARD, CREDENTIALS, {
        fetchImpl: mockFetch({ ok: false, status, textBody: "nope" }) as unknown as typeof fetch
      });
      expect(result).toMatchObject({ status: "failed", category, cardCreated: "no" });
    });
  }
});

describe("postCard: ambiguous outcomes", () => {
  it("treats a 5xx as unknown, because the card may exist", async () => {
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: mockFetch({ ok: false, status: 503, textBody: "unavailable" }) as unknown as typeof fetch
    });
    expect(result).toMatchObject({ status: "unknown", category: "server", cardCreated: "unknown" });
  });

  it("treats a network failure as unknown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toMatchObject({ status: "unknown", category: "network", cardCreated: "unknown" });
  });

  it("treats a timeout as unknown", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5
    });

    expect(result).toMatchObject({ status: "unknown", category: "timeout", cardCreated: "unknown" });
  });

  it("treats a 2xx with no card id as unknown rather than guessing", async () => {
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: mockFetch({ jsonBody: {} }) as unknown as typeof fetch
    });
    expect(result).toMatchObject({ status: "unknown", cardCreated: "unknown" });
  });

  it("never retries an ambiguous request", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    // One report must never become two.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("secret handling", () => {
  it("redacts credentials from an error body", async () => {
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: mockFetch({
        ok: false,
        status: 400,
        textBody: `invalid token ${CREDENTIALS.token} for key ${CREDENTIALS.apiKey}`
      }) as unknown as typeof fetch
    });

    if (result.status === "created") throw new Error("unexpected");
    expect(result.message).not.toContain(CREDENTIALS.token);
    expect(result.message).not.toContain(CREDENTIALS.apiKey);
    expect(result.message).toContain("[redacted]");
  });

  it("redacts credentials from a thrown network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connection to ...token=${CREDENTIALS.token} failed`);
    });
    const result = await postCard(CARD, CREDENTIALS, { fetchImpl: fetchImpl as unknown as typeof fetch });

    if (result.status === "created") throw new Error("unexpected");
    expect(result.message).not.toContain(CREDENTIALS.token);
  });

  it("redactSecrets ignores empty secrets rather than redacting everything", () => {
    expect(redactSecrets("hello world", [""])).toBe("hello world");
    expect(redactSecrets("a secret b", ["secret"])).toBe("a [redacted] b");
  });
});

describe("describeOutcome", () => {
  it("says plainly when nothing was created", async () => {
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: mockFetch({ ok: false, status: 401 }) as unknown as typeof fetch
    });
    expect(describeOutcome(result)).toContain("No card was created");
  });

  it("warns that a retry could duplicate when the outcome is unknown", async () => {
    const result = await postCard(CARD, CREDENTIALS, {
      fetchImpl: mockFetch({ ok: false, status: 500 }) as unknown as typeof fetch
    });
    expect(describeOutcome(result)).toContain("may or may not");
    expect(describeOutcome(result)).toContain("duplicate");
  });
});
