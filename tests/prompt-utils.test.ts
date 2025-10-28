import { strict as assert } from 'assert';
import { test } from 'node:test';
import { buildContinuationParts, buildUserPromptText, previewText } from '../src/core/prompt/prompt.builder';

test('previewText truncates with ellipsis', () => {
  const input = 'a'.repeat(10);
  const out = previewText(input, 5);
  assert.equal(out, 'aaaaa[...]');
});

test('buildUserPromptText respects system support', () => {
  const system = 'SYS';
  const prompt = 'PROMPT';
  assert.equal(buildUserPromptText(system, prompt, true), 'PROMPT');
  assert.equal(buildUserPromptText(system, prompt, false), 'SYS\n\nPROMPT');
});

test('buildContinuationParts structure', () => {
  const parts = buildContinuationParts('prev', 'orig');
  assert.equal(parts.length, 3);
  assert.equal(parts[0].role, 'user');
  assert.equal((parts[0].parts?.[0] as any).text, 'orig');
  assert.equal(parts[1].role, 'model');
  assert.equal((parts[1].parts?.[0] as any).text, 'prev');
});
