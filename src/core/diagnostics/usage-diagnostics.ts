import { UsageMetadata } from '@google/generative-ai';

export interface UsageDiagnostics {
  /** Prompt tokens as reported by the provider. */
  promptTokens: number;
  /** Total tokens across generated candidates (provider-reported). */
  candidateTokens: number;
  /** Total tokens for the full request (prompt + candidates). */
  totalTokens: number;
  /** Estimated visible tokens derived from text length (rough ~4 chars/token). */
  visibleTokensApprox: number;
  /** Estimated internal reasoning tokens (total output minus visible). */
  thoughtsTokens: number;
  /** Ratio of internal reasoning to output tokens (0..1). */
  thoughtsRatio: number;
  /** Ratio of visible output to output tokens (0..1). */
  visibleRatio: number;
  /** Optional note on how thoughts were inferred. */
  inferenceNote?: string | null;
}

export interface ExtendedUsageMetadata extends UsageMetadata {
  thoughtsTokenCount?: number;
}

/**
 * Builds usage diagnostics from provider metadata and output text.
 */
export function buildUsageDiagnostics(usage: UsageMetadata | undefined, text: string): UsageDiagnostics {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const u = (usage || {}) as ExtendedUsageMetadata;
  const prompt = num(u.promptTokenCount);
  const candidates = num(u.candidatesTokenCount);
  const total = num(u.totalTokenCount);
  const outputTotal = Math.max(0, total - prompt);

  // Approx visible tokens from text length (4 chars/token rough approx)
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

