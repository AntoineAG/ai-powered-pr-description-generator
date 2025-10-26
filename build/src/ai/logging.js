"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prefix = void 0;
exports.group = group;
function group(logger, title, fn) {
    logger.info(`::group::${title}`);
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.finally(() => logger.info('::endgroup::'));
        }
    }
    finally {
        logger.info('::endgroup::');
    }
}
const prefix = (provider) => `[AI][${provider}]`;
exports.prefix = prefix;
