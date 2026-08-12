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
    onmessage: null,
    onerror: null,
    onmessageerror: null
  };
  const deliver = (message: WorkerMessage) =>
    worker.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  const crash = (message?: string) => worker.onerror?.({ message } as ErrorEvent);
  const garble = () => worker.onmessageerror?.({} as MessageEvent);
  return { worker, posted, deliver, crash, garble };
}

function handlers() {
  return {
    onProgress: vi.fn<AnalysisRunHandlers["onProgress"]>(),
    onError: vi.fn<AnalysisRunHandlers["onError"]>(),
    onResult: vi.fn<AnalysisRunHandlers["onResult"]>()
  } satisfies AnalysisRunHandlers;
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
    const payload = runA.onResult.mock.calls[0]![0] as { analysisKey: string };
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

  it("ends the run with an error when the worker itself crashes, instead of stranding the UI", () => {
    // The bug this proves fixed: only onmessage was attached, so a worker that
    // failed to load, got OOM-killed, or threw before posting left the UI in
    // "running" forever — progress frozen, Analyze disabled, no message.
    const { worker, deliver, crash } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    crash("worker exploded");

    expect(run.onError).toHaveBeenCalledTimes(1);
    expect(run.onError.mock.calls[0]![0]).toContain("worker exploded");
    expect(runner.isRunning()).toBe(false);

    // A late message from the dead run must not resurrect it.
    deliver(resultMessage("key-A", "stale"));
    expect(run.onResult).not.toHaveBeenCalled();
  });

  it("reports a worker crash without details as a generic failure", () => {
    const { worker, crash } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    crash();

    expect(run.onError).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(false);
  });

  it("ends the run when a worker response cannot be deserialized", () => {
    const { worker, garble } = fakeWorker();
    const runner = createAnalysisRunner(worker);
    const run = handlers();

    runner.start(request("key-A"), run);
    garble();

    expect(run.onError).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(false);
  });

  it("ignores worker-level errors when no run is live", () => {
    const { worker, crash, garble } = fakeWorker();
    createAnalysisRunner(worker);

    // Nothing to notify; must not throw.
    crash("idle crash");
    garble();
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

    const payload = runB.onResult.mock.calls[0]![0] as { analysisKey: string };
    expect(payload.analysisKey).toBe("key-B");
  });
});
