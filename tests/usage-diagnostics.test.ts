import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildUsageDiagnostics } from '../src/core/diagnostics/usage-diagnostics';

test('usage diagnostics basic estimation', () => {
  const usage = { promptTokenCount: 10, candidatesTokenCount: 30, totalTokenCount: 40 };
  const text = 'a'.repeat(40); // ~10 tokens visible approx
  const diag = buildUsageDiagnostics(usage as any, text);
  assert.equal(diag.promptTokens, 10);
  assert.equal(diag.candidateTokens, 30);
  assert.equal(diag.totalTokens, 40);
  assert.equal(diag.visibleTokensApprox, 10);
  // outputTotal = 30, thoughts = min(candidates - visible, outputTotal) = 20
  assert.equal(diag.thoughtsTokens, 20);
  assert.ok(diag.thoughtsRatio > 0.6 && diag.thoughtsRatio < 0.7);
});

test('usage diagnostics prefers thoughtsTokenCount', () => {
  const usage = { promptTokenCount: 5, candidatesTokenCount: 25, totalTokenCount: 30, thoughtsTokenCount: 7 };
  const diag = buildUsageDiagnostics(usage as any, '');
  assert.equal(diag.thoughtsTokens, 7);
});
