import { strict as assert } from 'assert';
import { test } from 'node:test';
import { generateWithRetry } from '../src/core/utils/retry';

test('generateWithRetry retries and succeeds', async () => {
  let callCount = 0;
  const sequence = [503, 503, 200];
  const task = async (_model: string) => {
    const status = sequence[callCount] ?? 200;
    callCount++;
    if (status !== 200) {
      const err: any = new Error('overload');
      err.status = status;
      throw err;
    }
    return 'ok';
  };

  const out = await generateWithRetry(task, {
    logger: console as any,
    provider: 'Gemini',
    initialModel: 'm1',
    retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0, consecutive503ToSwitch: 2, modelLadder: ['m2'] },
  });
  assert.equal(out.value, 'ok');
  assert.ok(out.attempts >= 3);
});

