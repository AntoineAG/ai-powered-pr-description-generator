"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const node_test_1 = require("node:test");
const retry_1 = require("../src/core/utils/retry");
(0, node_test_1.test)('generateWithRetry retries and succeeds', async () => {
    let callCount = 0;
    const sequence = [503, 503, 200];
    const task = async (_model) => {
        const status = sequence[callCount] ?? 200;
        callCount++;
        if (status !== 200) {
            const err = new Error('overload');
            err.status = status;
            throw err;
        }
        return 'ok';
    };
    const out = await (0, retry_1.generateWithRetry)(task, {
        logger: console,
        provider: 'Gemini',
        initialModel: 'm1',
        retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2, jitterMs: 0, consecutive503ToSwitch: 2, modelLadder: ['m2'] },
    });
    assert_1.strict.equal(out.value, 'ok');
    assert_1.strict.ok(out.attempts >= 3);
});
