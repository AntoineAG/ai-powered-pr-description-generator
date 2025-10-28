import { UsageMetadata } from '@google/generative-ai';

export interface UsageDiagnostics {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  visibleTokensApprox: number;
  thoughtsTokens: number;
  thoughtsRatio: number;
  visibleRatio: number;
  inferenceNote?: string | null;
}

export interface ExtendedUsageMetadata extends UsageMetadata {
  thoughtsTokenCount?: number;
}

export function buildUsageDiagnostics(usage: UsageMetadata | undefined, text: string): UsageDiagnostics {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const u = (usage || {}) as ExtendedUsageMetadata;
  const prompt = num(u.promptTokenCount);
  const candidates = num(u.candidatesTokenCount);
  const total = num(u.totalTokenCount);
  const outputTotal = Math.max(0, total - prompt);

  const approxVisibleRaw = Math.max(0, Math.ceil((text || '').length / 4));
  const visibleApprox = Math.min(approxVisibleRaw, outputTotal);

  let thoughts = 0;
  let inferenceNote: string | null = null;
  const thoughtsReported = num(u.thoughtsTokenCount);

  if (thoughtsReported > 0) {
    thoughts = Math.min(thoughtsReported, outputTotal);
  } else if (candidates > 0) {
    thoughts = Math.max(0, Math.min(candidates - visibleApprox, outputTotal));
    inferenceNote = 'estimated from candidates − visible';
  } else {
    thoughts = Math.max(0, outputTotal - visibleApprox);
    if (outputTotal > 0) {
      inferenceNote = 'inferred from (total − prompt) − visible';
    }
  }

  const denom = Math.max(1, outputTotal);
  const thoughtsRatio = thoughts / denom;
  const visibleRatio = Math.max(0, 1 - thoughtsRatio);

  return {
    promptTokens: prompt,
    candidateTokens: candidates,
    totalTokens: total,
    visibleTokensApprox: visibleApprox,
    thoughtsTokens: thoughts,
    thoughtsRatio,
    visibleRatio,
    inferenceNote,
  };
}

