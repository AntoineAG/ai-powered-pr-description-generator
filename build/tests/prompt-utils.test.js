"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const node_test_1 = require("node:test");
const prompt_utils_1 = require("../src/ai/prompt-utils");
(0, node_test_1.test)('previewText truncates with ellipsis', () => {
    const input = 'a'.repeat(10);
    const out = (0, prompt_utils_1.previewText)(input, 5);
    assert_1.strict.equal(out, 'aaaaa[...]');
});
(0, node_test_1.test)('buildUserPromptText respects system support', () => {
    const system = 'SYS';
    const prompt = 'PROMPT';
    assert_1.strict.equal((0, prompt_utils_1.buildUserPromptText)(system, prompt, true), 'PROMPT');
    assert_1.strict.equal((0, prompt_utils_1.buildUserPromptText)(system, prompt, false), 'SYS\n\nPROMPT');
});
(0, node_test_1.test)('buildContinuationParts structure', () => {
    const parts = (0, prompt_utils_1.buildContinuationParts)('prev', 'orig');
    assert_1.strict.equal(parts.length, 3);
    assert_1.strict.equal(parts[0].role, 'user');
    assert_1.strict.equal((parts[0].parts?.[0]).text, 'orig');
    assert_1.strict.equal(parts[1].role, 'model');
    assert_1.strict.equal((parts[1].parts?.[0]).text, 'prev');
});
