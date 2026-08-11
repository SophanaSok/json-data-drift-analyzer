import { describe, expect, it, vi } from "vitest";
import { createAnalysisRunner, type AnalysisRunHandlers, type AnalysisWorkerLike } from "./analysis-runner";
import type { AnalyzeRequest, WorkerMessage } from "../../workers/protocol";
import type { AnalysisResult } from "../../engine/types";

// The runner only reads payload.analysisKey from a request, and dispatches whole
// message payloads through; the analysis bodies are opaque to it.
function request(analysisKey: string): AnalyzeRequest {
  return {
    type: "analyze",
    payload: {
      baselineFileName: "baseline.json",
      latestFileName: "latest.json",
      baselineText: "{}",
      latestText: "{}",
      analysisKey,
      config: { collectionPath: "Export", identityFields: ["Id"], ignoredFields: [], profileId: "p" }
    }
  };
}

function resultMessage(analysisKey: string, marker: string): WorkerMessage {
  return {
    type: "result",
    payload: { analysisKey, analysis: { marker } as unknown as AnalysisResult, review: null }
  };
}

function fakeWorker() {
  const posted: AnalyzeRequest[] = [];
  const worker: AnalysisWorkerLike = {
    postMessage: (message) => posted.push(message),
    onmessage: null
  };
  const deliver = (message: WorkerMessage) =>
    worker.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  return { worker, posted, deliver };
}

function handlers(): AnalysisRunHandlers & {
  onProgress: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onResult: ReturnType<typeof vi.fn>;
} {
  return { onProgress: vi.fn(), onError: vi.fn(), onResult: vi.fn() };
}

describe("analysis runner: results reach only the run that asked for them", () => {
  it("cannot hand run A's result to run B — the original cache-poisoning race", () => {
    // The bug this proves fixed: click Analyze for A, click Analyze for B before A
    // finishes, and A's result used to arrive at B's handler, which cached analysis
    // A under key B. Now the second start is refused and A's result is dispatched
    // to A's handlers by the key the worker echoes.
    const { worker, posted, deliver } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const runA = handlers();
    const runB = handlers();

    expect(runner.start(request("key-A"), runA)).toBe(true);
    expect(runner.start(request("key-B"), runB)).toBe(false);
    expect(posted).toHaveLength(1);

    deliver(resultMessage("key-A", "analysis-A"));

    expect(runA.onResult).toHaveBeenCalledTimes(1);
    const payload = runA.onResult.mock.calls[0][0] as { analysisKey: string };
    expect(payload.analysisKey).toBe("key-A");
    // Run B's handlers — the ones that used to cache A's result under key B —
    // never see anything.
    expect(runB.onResult).not.toHaveBeenCalled();
    expect(runB.onError).not.toHaveBeenCalled();
    expect(runB.onProgress).not.toHaveBeenCalled();
  });

  it("drops a message whose key matches no live run", () => {
    const { worker, deliver } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    deliver(resultMessage("key-other", "foreign"));

    expect(run.onResult).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(true);
  });

  it("drops messages arriving after cancel instead of navigating a user who backed out", () => {
    const { worker, deliver } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    runner.cancel();
    deliver(resultMessage("key-A", "stale"));

    expect(run.onResult).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);
  });

  it("routes progress to the live run and ends the run on error", () => {
    const { worker, deliver } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    deliver({ type: "progress", payload: { analysisKey: "key-A", step: "Parsing files" } });
    expect(run.onProgress).toHaveBeenCalledWith("Parsing files");

    deliver({ type: "error", payload: { analysisKey: "key-A", message: "boom" } });
    expect(run.onError).toHaveBeenCalledWith("boom");
    expect(runner.isRunning()).toBe(false);
  });

  it("allows a new run once the previous one finished", () => {
    const { worker, posted, deliver } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const runA = handlers();
    const runB = handlers();

    runner.start(request("key-A"), runA);
    deliver(resultMessage("key-A", "analysis-A"));

    expect(runner.start(request("key-B"), runB)).toBe(true);
    expect(posted).toHaveLength(2);
    deliver(resultMessage("key-B", "analysis-B"));

    const payload = runB.onResult.mock.calls[0][0] as { analysisKey: string };
    expect(payload.analysisKey).toBe("key-B");
  });
});
