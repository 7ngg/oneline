// Promise façade over the solver worker with:
// - single-flight: a new run auto-cancels the previous one; stale results are
//   dropped by requestId
// - watchdog: if a cancelled worker fails to acknowledge within 2 s it is
//   hard-terminated and respawned
// - crash recovery: onerror/onmessageerror rejects the pending run and
//   respawns, leaving app state intact

import type { GenerateProgress, GenerateRequest, GenerateResult } from '../engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

const WATCHDOG_MS = 2_000;

interface Pending {
  requestId: number;
  resolve(result: GenerateResult): void;
  reject(err: Error): void;
  onProgress?(p: GenerateProgress): void;
}

export class SolverClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextRequestId = 1;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private spawn(): Worker {
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    worker.onerror = () => this.fail(new Error('The generation worker crashed.'));
    worker.onmessageerror = () => this.fail(new Error('The generation worker sent an unreadable message.'));
    return worker;
  }

  private ensureWorker(): Worker {
    this.worker ??= this.spawn();
    return this.worker;
  }

  private handle(msg: WorkerResponse): void {
    if (!this.pending || msg.requestId !== this.pending.requestId) return; // stale
    if (msg.type === 'progress') {
      this.pending.onProgress?.(msg.progress);
      return;
    }
    this.clearWatchdog();
    const pending = this.pending;
    this.pending = null;
    if (msg.type === 'result') pending.resolve(msg.result);
    else pending.reject(new Error(msg.message));
  }

  private fail(err: Error): void {
    this.clearWatchdog();
    const pending = this.pending;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    pending?.reject(err);
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  run(payload: GenerateRequest, onProgress?: (p: GenerateProgress) => void): Promise<GenerateResult> {
    this.cancel();
    const requestId = this.nextRequestId++;
    const worker = this.ensureWorker();
    return new Promise<GenerateResult>((resolve, reject) => {
      this.pending = { requestId, resolve, reject, ...(onProgress ? { onProgress } : {}) };
      const msg: WorkerRequest = { type: 'generate', requestId, payload };
      worker.postMessage(msg);
    });
  }

  /** Cancel the in-flight run; resolves it with whatever the worker returns. */
  cancel(): void {
    if (!this.pending || !this.worker) return;
    const msg: WorkerRequest = { type: 'cancel', requestId: this.pending.requestId };
    this.worker.postMessage(msg);
    // watchdog: a stuck worker gets terminated and the caller unblocked
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      if (this.pending) this.fail(new Error('Cancellation timed out; the worker was restarted.'));
    }, WATCHDOG_MS);
  }

  dispose(): void {
    this.clearWatchdog();
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }
}

export const solverClient = new SolverClient();
