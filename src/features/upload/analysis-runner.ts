import type { AnalyzeRequest, WorkerMessage, WorkerStep } from "../../workers/protocol";

/**
 * Correlates analysis requests with worker responses.
 *
 * The worker is a module singleton shared by every run, and its messages arrive
 * asynchronously. Correlating them by closure alone is how one run's result gets
 * handled — and cached — under another run's key: start run A, start run B, and A's
 * result arrives at B's handler. This runner pairs each run's handlers with its
 * analysisKey at start and dispatches every message by the key the worker echoes,
 * so a message can only ever reach the handlers of the request that caused it.
 *
 * One run at a time, by design: the UI disables Analyze while a run is live, and
 * `start` refuses a second run rather than interleaving two.
 */

export type AnalysisRunHandlers = {
  onProgress: (step: WorkerStep) => void;
  onError: (message: string) => void;
  onResult: (payload: Extract<WorkerMessage, { type: "result" }>["payload"]) => void | Promise<void>;
};

/** The subset of Worker this runner needs, so tests can inject a fake. */
export type AnalysisWorkerLike = {
  postMessage: (request: AnalyzeRequest) => void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
};

export type AnalysisRunner = {
  /** Begin a run. Returns false — and posts nothing — when a run is already live. */
  start: (request: AnalyzeRequest, handlers: AnalysisRunHandlers) => boolean;
  /** Abandon the live run: its later messages are dropped, not redirected. */
  cancel: () => void;
  isRunning: () => boolean;
};

export function createAnalysisRunner(worker: AnalysisWorkerLike): AnalysisRunner {
  let active: { analysisKey: string; handlers: AnalysisRunHandlers } | null = null;

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    // A message for a finished, cancelled, or foreign run answers nothing anyone is
    // still asking. Acting on it would attribute one run's output to another.
    if (!active || message.payload.analysisKey !== active.analysisKey) {
      return;
    }

    if (message.type === "progress") {
      active.handlers.onProgress(message.payload.step);
      return;
    }

    // The run ends on result or error; clear BEFORE dispatching so a handler that
    // starts the next run cannot race the state.
    const { handlers } = active;
    active = null;
    if (message.type === "error") {
      handlers.onError(message.payload.message);
      return;
    }
    void handlers.onResult(message.payload);
  };

  return {
    start: (request, handlers) => {
      if (active) {
        return false;
      }
      active = { analysisKey: request.payload.analysisKey, handlers };
      worker.postMessage(request);
      return true;
    },
    cancel: () => {
      active = null;
    },
    isRunning: () => active !== null
  };
}
