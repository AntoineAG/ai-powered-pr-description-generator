"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const gemini_config_1 = require("../providers/gemini/gemini.config");
const gemini_helper_1 = __importDefault(require("../providers/gemini/gemini.helper"));
const openai_config_1 = require("../providers/openai/openai.config");
const openai_helper_1 = __importDefault(require("../providers/openai/openai.helper"));
const aiHelperResolver = (aiHelperParams) => {
    const { aiName, model, temperature } = aiHelperParams;
    core.info(`[AI] Resolver -> provider=${aiName}, model=${model}, temperature=${temperature}`);
    const logger = {
        startGroup: (msg) => core.startGroup(msg),
        endGroup: () => core.endGroup(),
        info: (msg) => core.info(msg),
        warn: (msg) => core.warning(msg),
        error: (msg) => core.error(msg),
        debug: (msg) => core.info(msg),
    };
    switch (aiName?.toLowerCase()) {
        case 'open-ai':
        case 'openai': {
            const config = (0, openai_config_1.buildOpenAIConfig)(aiHelperParams);
            return new openai_helper_1.default({ config, logger });
        }
        case 'gemini':
        default: {
            const config = (0, gemini_config_1.buildGeminiConfig)(aiHelperParams);
            return new gemini_helper_1.default({ config, logger });
        }
    }
};
exports.default = aiHelperResolver;
