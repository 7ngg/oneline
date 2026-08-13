// UI ⇄ solver-worker message contract. Discriminated unions only — anything
// crossing the boundary must survive structured clone.

import type { GenerateProgress, GenerateRequest, GenerateResult } from '../engine';

export type WorkerRequest =
  | { type: 'generate'; requestId: number; payload: GenerateRequest }
  | { type: 'cancel'; requestId: number };

export type WorkerResponse =
  | { type: 'progress'; requestId: number; progress: GenerateProgress }
  | { type: 'result'; requestId: number; result: GenerateResult }
  | { type: 'error'; requestId: number; message: string };
