"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUsageDiagnostics = buildUsageDiagnostics;
/**
 * Builds usage diagnostics from provider metadata and output text.
 */
function buildUsageDiagnostics(usage, text) {
    const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
    const u = (usage || {});
    const prompt = num(u.promptTokenCount);
    const candidates = num(u.candidatesTokenCount);
    const total = num(u.totalTokenCount);
    const outputTotal = Math.max(0, total - prompt);
    // Approx visible tokens from text length (4 chars/token rough approx)
    const approxVisibleRaw = Math.max(0, Math.ceil((text || '').length / 4));
    const visibleApprox = Math.min(approxVisibleRaw, outputTotal);
    let thoughts = 0;
    let inferenceNote = null;
    const thoughtsReported = num(u.thoughtsTokenCount);
    if (thoughtsReported > 0) {
        thoughts = Math.min(thoughtsReported, outputTotal);
    }
    else if (candidates > 0) {
        thoughts = Math.max(0, Math.min(candidates - visibleApprox, outputTotal));
        inferenceNote = 'estimated from candidates − visible';
    }
    else {
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
