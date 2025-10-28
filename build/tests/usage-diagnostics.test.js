"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const node_test_1 = require("node:test");
const usage_diagnostics_1 = require("../src/core/diagnostics/usage-diagnostics");
(0, node_test_1.test)('usage diagnostics basic estimation', () => {
    const usage = { promptTokenCount: 10, candidatesTokenCount: 30, totalTokenCount: 40 };
    const text = 'a'.repeat(40); // ~10 tokens visible approx
    const diag = (0, usage_diagnostics_1.buildUsageDiagnostics)(usage, text);
    assert_1.strict.equal(diag.promptTokens, 10);
    assert_1.strict.equal(diag.candidateTokens, 30);
    assert_1.strict.equal(diag.totalTokens, 40);
    assert_1.strict.equal(diag.visibleTokensApprox, 10);
    // outputTotal = 30, thoughts = min(candidates - visible, outputTotal) = 20
    assert_1.strict.equal(diag.thoughtsTokens, 20);
    assert_1.strict.ok(diag.thoughtsRatio > 0.6 && diag.thoughtsRatio < 0.7);
});
(0, node_test_1.test)('usage diagnostics prefers thoughtsTokenCount', () => {
    const usage = { promptTokenCount: 5, candidatesTokenCount: 25, totalTokenCount: 30, thoughtsTokenCount: 7 };
    const diag = (0, usage_diagnostics_1.buildUsageDiagnostics)(usage, '');
    assert_1.strict.equal(diag.thoughtsTokens, 7);
});
