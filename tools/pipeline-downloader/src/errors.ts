/**
 * Failure categories and the one retry rule this tool has.
 *
 * Every failure is classified before it reaches the console or the run log, so that a
 * run history stays greppable ("how often does login break?") without anyone having to
 * parse prose. The categories are deliberately coarse: a category nobody can assign
 * confidently is a category that ends up meaning nothing.
 */

export const ERROR_CATEGORIES = [
  /** Bad arguments, missing environment variables, or unfilled selector placeholders. */
  "config",
  /** The dashboard did not accept the credentials, or the session never established. */
  "auth",
  /** A page did not load or did not look like the page we expected. */
  "navigation",
  /** The dashboard loaded but the requested run is not listed for that bot. */
  "run_not_found",
  /** The export did not arrive in time. The only category this tool retries. */
  "download_timeout",
  /** The download started and then failed for some other reason. */
  "download_failed",
  /** The file arrived but is not parseable JSON, so it is not worth keeping. */
  "invalid_payload",
  /** Could not create the directory, write the file, or the target already exists. */
  "filesystem",
  /** Anything unclassified. Investigate rather than assume. */
  "unknown"
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** An error that already knows how it should be recorded. */
export class DownloadError extends Error {
  category: ErrorCategory;

  /**
   * The run this failure concerns, when it was already resolved when things went wrong.
   * Undefined for anything that failed before the dashboard named a run.
   */
  resolvedRun?: string;

  constructor(category: ErrorCategory, message: string) {
    super(message);
    this.name = "DownloadError";
    this.category = category;
  }
}

/**
 * Classify anything thrown that is not already a `DownloadError`.
 *
 * Unrecognised failures become `unknown` rather than being guessed into a specific
 * bucket — a wrong category is worse than an honest one, because it sends the next
 * person debugging in the wrong direction.
 */
export function toDownloadError(error: unknown): DownloadError {
  if (error instanceof DownloadError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new DownloadError("unknown", message);
}

/** One attempt plus two retries. */
export const MAX_DOWNLOAD_ATTEMPTS = 3;

/** Pause between download attempts. Fixed, not exponential; three attempts is too few to matter. */
export const RETRY_DELAY_MS = 2_000;

/**
 * Only a download timeout is retried.
 *
 * A timeout means the export never arrived, so re-triggering it repeats a read, not a
 * write. Every other category is either permanent within a run (bad credentials, a run
 * that is not listed, an unfilled selector) or ambiguous enough that a blind retry
 * would just produce the same failure more slowly.
 */
export function isRetryable(category: ErrorCategory): boolean {
  return category === "download_timeout";
}

export type RetryOptions = {
  maxAttempts?: number;
  delayMs?: number;
  /** Called before each retry so the operator can see the tool is still working. */
  onRetry?: (attempt: number, error: DownloadError) => void;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
};

export type RetryResult<T> = {
  value: T;
  /** How many attempts it actually took, 1-based. Recorded so slow runs are visible. */
  attempts: number;
};

/**
 * Run `operation`, retrying it only while it fails with a retryable category.
 *
 * @param operation receives the 1-based attempt number
 * @throws the last DownloadError once attempts are exhausted or the failure is not retryable
 */
export async function retryOnDownloadTimeout<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? MAX_DOWNLOAD_ATTEMPTS;
  const delayMs = options.delayMs ?? RETRY_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return { value: await operation(attempt), attempts: attempt };
    } catch (error) {
      const downloadError = toDownloadError(error);
      if (!isRetryable(downloadError.category) || attempt >= maxAttempts) {
        throw downloadError;
      }
      options.onRetry?.(attempt, downloadError);
      await sleep(delayMs);
    }
  }
}
