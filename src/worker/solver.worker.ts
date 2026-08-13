// Web Worker entry: runs the engine pipeline off the UI thread. Progress is
// throttled to ≥100 ms; cancellation is a flag the pipeline polls between
// batches.

import { generate } from '../engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

const cancelled = new Set<number>();

const post = (msg: WorkerResponse) => {
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(msg);
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.requestId);
    return;
  }
  const { requestId, payload } = msg;
  let lastProgressAt = 0;
  try {
    const result = generate(payload, {
      now: () => performance.now(),
      shouldCancel: () => cancelled.has(requestId),
      onProgress: (progress) => {
        const t = performance.now();
        if (t - lastProgressAt >= 100) {
          lastProgressAt = t;
          post({ type: 'progress', requestId, progress });
        }
      },
    });
    post({ type: 'result', requestId, result });
  } catch (err) {
    // the pipeline is total; reaching this is a bug — surface it, don't hang
    post({ type: 'error', requestId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(requestId);
  }
};
