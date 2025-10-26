"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIError = void 0;
class AIError extends Error {
    constructor(message, meta, cause) {
        super(message);
        this.name = 'AIError';
        this.meta = meta;
        this.causeErr = cause;
    }
    static wrap(message, meta, cause) {
        return new AIError(message, meta, cause);
    }
}
exports.AIError = AIError;
