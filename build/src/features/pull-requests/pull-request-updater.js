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
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const resolver_1 = __importDefault(require("../../core/resolver"));
const git_helper_1 = require("../../integrations/github/git.helper");
/**
 * Orchestrates generating and applying an AI-written PR description (and optional title),
 * while enforcing Conventional Commit rules and monorepo-aware scopes.
 */
class PullRequestUpdater {
    constructor() {
        this.gitHelper = new git_helper_1.GitHelper((0, core_1.getInput)('ignores'));
        this.context = github_1.context;
        const aiName = (0, core_1.getInput)('ai_name', { required: true }).trim().toLowerCase().replace('open-ai', 'openai');
        const model = ((0, core_1.getInput)('ai_model') || '').trim() || (aiName === 'openai' ? 'gpt-4.1' : 'gemini-2.5-flash');
        const apiKey = (0, core_1.getInput)('api_key', { required: true }).trim();
        const temperature = Number.parseFloat((0, core_1.getInput)('temperature') || '0.8');
        this.aiHelper = (0, resolver_1.default)({ apiKey, aiName, temperature, model });
        core.info(`[PR-Description] AI configured provider=${aiName} model=${model} temperature=${temperature}`);
        const githubToken = (0, core_1.getInput)('github_token', { required: true }).trim();
        this.octokit = (0, github_1.getOctokit)(githubToken);
        this.updateTitle = ((0, core_1.getInput)('update_title') || '').toLowerCase() === 'true';
        // Read and validate prompt rules from inputs
        this.rules = this.readRulesFromInputs();
        core.info(`[PR] rules ${JSON.stringify(this.rules)}`);
    }
    clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
    parseIntOrDefault(raw, fallback, nameForLog, min, max) {
        const s = (raw || '').trim();
        const v = Number.parseInt(s, 10);
        if (!Number.isFinite(v)) {
            core.warning(`[PR][rules] ${nameForLog} invalid ('${raw ?? ''}'); using default ${fallback}`);
            return fallback;
        }
        const clamped = this.clamp(v, min, max);
        if (clamped !== v) {
            core.warning(`[PR][rules] ${nameForLog} out of range (${v}); clamped to ${clamped}`);
        }
        return clamped;
    }
    readRulesFromInputs() {
        // Defaults mirror action.yml defaults
        const DEFAULTS = {
            titleMaxLen: 120,
            descMaxItems: 5,
            descMaxWordsPerItem: 25,
            descMaxTotalWords: 300,
            // Emoji rules defaults
            allowTitleEmojis: true,
            allowDescriptionEmojis: true,
            titleEmojis: ['✨', '🐛', '♻️', '⚡️', '🔥', '🚀', '📝', '🔧', '🏗️', '🔒️', '✅', '🎉'],
            descriptionEmojis: ['✨', '🐛', '♻️', '⚡️', '🔥', '🚀', '📝', '🔧', '🏗️', '🔒️', '✅', '🎉', '⬆️', '⬇️', '📦️', '📈', '🧪', '🗑️', '👷', '🚧', '📌', '➕', '➖', '🔨', '🌐', '✏️', '⏪️', '🔀', '👽️', '🚚', '📄', '💥', '🍱', '♿️', '💡', '💬', '🗃️', '🔊', '🔇', '👥', '🚸', '📱', '🤡', '🙈', '📸', '⚗️', '🔍️', '🏷️', '🌱', '🚩', '🥅', '💫', '🛂', '🩹', '🧐', '⚰️', '🧱', '🧑‍💻', '💸', '🧵', '🦺', '✈️'],
        };
        const titleRaw = (0, core_1.getInput)('title_max_len');
        const itemsRaw = (0, core_1.getInput)('desc_max_items');
        const wordsPerItemRaw = (0, core_1.getInput)('desc_max_words_per_item');
        const totalWordsRaw = (0, core_1.getInput)('desc_max_total_words');
        const allowTitleEmojisRaw = (0, core_1.getInput)('allow_title_emojis');
        const allowDescEmojisRaw = (0, core_1.getInput)('allow_description_emojis');
        const titleEmojisRaw = (0, core_1.getInput)('allowed_emojis_titles');
        const descEmojisRaw = (0, core_1.getInput)('allowed_emojis_descriptions');
        const titleMaxLen = this.parseIntOrDefault(titleRaw, DEFAULTS.titleMaxLen, 'title_max_len', 1, 300);
        const descMaxItems = this.parseIntOrDefault(itemsRaw, DEFAULTS.descMaxItems, 'desc_max_items', 1, 50);
        const descMaxWordsPerItem = this.parseIntOrDefault(wordsPerItemRaw, DEFAULTS.descMaxWordsPerItem, 'desc_max_words_per_item', 1, 100);
        const descMaxTotalWords = this.parseIntOrDefault(totalWordsRaw, DEFAULTS.descMaxTotalWords, 'desc_max_total_words', 1, 2000);
        const parseBool = (raw, fallback) => {
            const s = (raw || '').trim().toLowerCase();
            if (['true', '1', 'yes', 'y'].includes(s))
                return true;
            if (['false', '0', 'no', 'n'].includes(s))
                return false;
            if (s)
                core.warning(`[PR][rules] boolean value invalid ('${raw}'); using default ${fallback}`);
            return fallback;
        };
        const allowTitleEmojis = parseBool(allowTitleEmojisRaw, DEFAULTS.allowTitleEmojis);
        const allowDescriptionEmojis = parseBool(allowDescEmojisRaw, DEFAULTS.allowDescriptionEmojis);
        const titleEmojis = (titleEmojisRaw || DEFAULTS.titleEmojis.join(','))
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        if (titleEmojis.length === 0) {
            core.warning('[PR][rules] allowed_emojis_titles is empty; using defaults');
        }
        const descriptionEmojis = (descEmojisRaw || DEFAULTS.descriptionEmojis.join(','))
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        if (descriptionEmojis.length === 0) {
            core.warning('[PR][rules] allowed_emojis_descriptions is empty; using defaults');
        }
        return {
            titleMaxLen,
            descMaxItems,
            descMaxWordsPerItem,
            descMaxTotalWords,
            allowTitleEmojis,
            allowDescriptionEmojis,
            titleEmojis: titleEmojis.length > 0 ? titleEmojis : [...DEFAULTS.titleEmojis],
            descriptionEmojis: descriptionEmojis.length > 0 ? descriptionEmojis : [...DEFAULTS.descriptionEmojis],
        };
    }
    parseConventionalCommit(title) {
        const re = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(?:\(([^)]+)\))?:\s*(.+)$/i;
        const m = title.match(re);
        if (m) {
            return { type: m[1].toLowerCase(), scope: m[2], subject: (m[3] || '').trim() };
        }
        return { subject: title.trim() };
    }
    parseConventionalCommitWithLog(title) {
        const parsed = this.parseConventionalCommit(title);
        core.info(`[Title] parse ${JSON.stringify({ input: title, parsed })}`);
        return parsed;
    }
    /**
     * Picks a scope from the changed files, preferring a monorepo scope if changes span many areas.   */
    chooseScopeFromFilesWithMonorepo(files) {
        if (!files || files.length === 0)
            return undefined;
        const hasApps = files.some(f => /^apps\//.test(f));
        const hasPackages = files.some(f => /^packages\//.test(f));
        const hasBackend = files.some(f => /(^|\/)backend(\/|$)/.test(f));
        const hasFrontend = files.some(f => /(^|\/)frontend(\/|$)/.test(f));
        const hasMonorepoFiles = files.some(f => /(^|\/)pnpm-workspace\.ya?ml$|(^|\/)turbo\.json$/.test(f));
        // Reuse existing logic for candidate scoring
        const candidates = {};
        const bump = (k) => { if (!k)
            return; candidates[k] = (candidates[k] || 0) + 1; };
        for (const f of files) {
            const parts = f.split('/').filter(Boolean);
            if (parts[0] === '.github') {
                bump('ci');
                continue;
            }
            if (parts.length === 1) {
                bump('root');
                continue;
            }
            if (parts[0] === 'apps' && parts[1]) {
                bump(parts[1]);
                continue;
            }
            if (parts[0] === 'packages' && parts[1]) {
                bump(parts[1]);
                continue;
            }
            if (['backend', 'frontend', 'server', 'client', 'api', 'web', 'app'].includes(parts[0])) {
                bump(parts[0]);
                continue;
            }
            if (parts[0] === 'src' && parts[1]) {
                bump(parts[1]);
                continue;
            }
            bump(parts[0]);
        }
        let best;
        let bestCount = 0;
        for (const [k, v] of Object.entries(candidates)) {
            if (v > bestCount) {
                best = k;
                bestCount = v;
            }
        }
        if (!best)
            return undefined;
        const total = files.length;
        const manyAreas = Object.keys(candidates).length > 3 || (hasApps && hasPackages) || (hasBackend && hasFrontend);
        if (bestCount / total < 0.5 || manyAreas || hasMonorepoFiles) {
            const detail = { total, best, bestCount, candidates, hasApps, hasPackages, hasBackend, hasFrontend, hasMonorepoFiles };
            core.debug(`[Title] scope -> monorepo ${JSON.stringify(detail)}`);
            core.info(`[Title] scope recommendation: monorepo (spread across many areas or monorepo signals) details=${JSON.stringify(detail)}`);
            return 'monorepo';
        }
        if (best === 'root')
            return 'repo';
        core.debug(`[Title] scope -> best ${JSON.stringify({ scope: best, total, bestCount, candidates })}`);
        core.info(`[Title] scope recommendation: ${best} (majority of changes)`);
        return best;
    }
    /**
     * Converts a sentence into imperative mood by lemmatizing the first verb-like token.
     */
    toImperative(subject) {
        if (!subject)
            return subject;
        let s = subject.trim().replace(/\s+/g, ' ').replace(/[\.!?]+$/g, '');
        const wordRe = /(^|:\s*|\()([A-Za-z][\w'-]*)/;
        const m = s.match(wordRe);
        if (!m)
            return s;
        const startIdx = (m.index || 0) + m[1].length;
        const word = m[2];
        const lemmas = {
            adds: 'add', added: 'add', adding: 'add',
            fixes: 'fix', fixed: 'fix', fixing: 'fix',
            updates: 'update', updated: 'update', updating: 'update',
            removes: 'remove', removed: 'remove', removing: 'remove',
            improves: 'improve', improved: 'improve', improving: 'improve',
            introduces: 'introduce', introduced: 'introduce', introducing: 'introduce',
            refactors: 'refactor', refactored: 'refactor', refactoring: 'refactor',
            migrates: 'migrate', migrated: 'migrate', migrating: 'migrate',
            renames: 'rename', renamed: 'rename', renaming: 'rename',
            optimizes: 'optimize', optimized: 'optimize', optimizing: 'optimize',
            uses: 'use', used: 'use', using: 'use',
            ensures: 'ensure', ensured: 'ensure', ensuring: 'ensure',
        };
        const lower = word.toLowerCase();
        const base = lemmas[lower] || lower;
        s = s.slice(0, startIdx) + base + s.slice(startIdx + word.length);
        return s;
    }
    /**
     * Converts to imperative and logs the transformation when it changes the input.
     */
    toImperativeWithLog(subject) {
        const result = this.toImperative(subject);
        if (result !== subject) {
            core.debug(`[Title] imperative ${JSON.stringify({ before: subject, after: result })}`);
        }
        return result;
    }
    /**
     * Monorepo-aware scoring-based commit type inference from diff and file types.
     */
    inferCommitTypeScored(diffOutput, files, currentTitle, subject) {
        const lowerAll = (s) => (s || '').toLowerCase();
        const d = lowerAll(diffOutput);
        const t = lowerAll(currentTitle + ' ' + subject);
        const isDocsFile = (f) => /(^docs\/|\.md$|README\.[^/]*$)/i.test(f);
        const isTestFile = (f) => /(\.test\.|\.spec\.|__tests__\/|^tests\/)/i.test(f);
        const isCiFile = (f) => /(^\.github\/|^\.circleci\/|gitlab-ci\.yml$|azure-pipelines\.yml$)/i.test(f);
        const isBuildFile = (f) => /(^Dockerfile$|docker-compose|^turbo\.json$|^pnpm-workspace\.ya?ml$|^package\.json$|^vite\.config|^webpack\.config|^rollup\.config|^tsconfig\.json$|babel|^Makefile$)/i.test(f);
        const isStyleFile = (f) => /(\.css$|\.scss$|\.sass$|\.less$)/i.test(f);
        const isCodeFile = (f) => /(\.ts$|\.tsx$|\.js$|\.jsx$|\.py$|\.go$|\.rb$|\.rs$|\.java$|\.php$)/i.test(f);
        const some = (pred) => files.some(pred);
        const scores = { feat: 0, fix: 0, docs: 0, style: 0, refactor: 0, perf: 0, test: 0, build: 0, ci: 0, chore: 0 };
        const reasons = [];
        const add = (k, n, reason) => { scores[k] += n; const msg = `+${n} => ${k} :: ${reason}`; reasons.push(msg); core.debug(`[Title] score ${msg}`); };
        if (some(isCodeFile))
            add('feat', 2, 'code changes present');
        if (some(isDocsFile))
            add('docs', 2, 'docs files present');
        if (some(isTestFile))
            add('test', 2, 'test files present');
        if (some(isCiFile))
            add('ci', some(isCodeFile) ? 1 : 3, 'ci files present');
        if (some(isBuildFile))
            add('build', some(isCodeFile) ? 2 : 3, 'build files present');
        if (some(isStyleFile))
            add('style', 2, 'style files present');
        const monorepoSignals = /turbo\.json|pnpm-workspace\.ya?ml|\bmonorepo\b|\bturbo\b/.test(d + ' ' + t) || files.some(f => /(^|\/)turbo\.json$|(^|\/)pnpm-workspace\.ya?ml$|^apps\//.test(f));
        if (monorepoSignals) {
            add('feat', 3, 'monorepo/turbo/pnpm signals');
            add('build', 2, 'monorepo tooling changes');
        }
        const addedFileSignals = (d.match(/\bcreate mode\b|\bnew file mode\b/g) || []).length;
        if (addedFileSignals >= 3)
            add('feat', 2, `many new files (${addedFileSignals})`);
        if (/\brefactor(ing|ed|s)?\b|\bcleanup\b|\brestructure\b|\brename\b/.test(d + ' ' + t))
            add('refactor', 2, 'refactor keywords');
        if (/\bperf(ormance)?\b|\boptimi[sz]e\b|\bfaster\b|\bspeed\b/.test(d + ' ' + t))
            add('perf', 2, 'performance keywords');
        const fixStrong = /\bfix(e[sd]|ing)?\b|\bbug\b|\berror\b|\bissue\b|\bcorrect\b/.test(d + ' ' + t);
        if (fixStrong)
            add('fix', 2, 'fix/bug keywords');
        let bestType = 'chore';
        let bestScore = -Infinity;
        for (const [k, v] of Object.entries(scores)) {
            if (v > bestScore) {
                bestType = k;
                bestScore = v;
            }
        }
        if (bestType === 'fix' && (monorepoSignals || addedFileSignals >= 3 || scores['feat'] >= scores['fix'] - 1)) {
            core.debug('[Title] adjust type: fix -> feat due to broader signals');
            reasons.push('adjust: fix -> feat (broader signals)');
            bestType = 'feat';
        }
        if (bestType === 'chore' && some(isCodeFile))
            bestType = 'feat';
        core.debug(`[Title] infer (scored) -> result ${JSON.stringify({ bestType, scores })}`);
        core.info(`[Title] type recommendation: ${bestType} | reasons=${reasons.join(' | ')} | scores=${JSON.stringify(scores)}`);
        return bestType;
    }
    /**
     * Formats a Conventional Commit title using AI suggestions (subject) and local heuristics (type/scope),
     * enforcing imperative form and ≤72 characters total length.
     */
    formatConventionalCommitTitle(subject, diffOutput, files, currentTitle, aiType, aiScope) {
        const parsed = this.parseConventionalCommitWithLog(subject);
        // Prefer type/scope parsed from a conventional string; otherwise, use AI-provided structured fields
        const allowedTypes = new Set(['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore']);
        const parsedType = parsed.type && allowedTypes.has(parsed.type) ? parsed.type : undefined;
        const metaType = (aiType || '').trim().toLowerCase() || undefined;
        const metaTypeValid = metaType && allowedTypes.has(metaType) ? metaType : undefined;
        let type = parsedType ?? metaTypeValid;
        let scope = (parsed.scope || '').trim() || undefined;
        if (!scope)
            scope = (aiScope || '').trim() || undefined;
        const originalType = type;
        const originalScope = scope || undefined;
        let bareSubject = parsed.type ? parsed.subject : subject;
        // If the AI included a leading emoji and/or conventional prefix inside the subject, remove it
        bareSubject = this.stripLeadingConventionalPrefix(bareSubject);
        core.debug(`[Title] format -> initial ${JSON.stringify({ subject, parsed, currentTitle })}`);
        // Determine a recommended type/scope from local heuristics
        const recommendedType = this.inferCommitTypeScored(diffOutput, files, currentTitle, bareSubject);
        const recommendedScope = this.chooseScopeFromFilesWithMonorepo(files);
        core.info(`[Title] recommendations type=${recommendedType} scope=${recommendedScope ?? '(none)'} (from diff/files)`);
        // Merge decision logging (before applying fallbacks)
        core.info(`[Title] merge inputs: ai.type=${aiType ?? '(none)'} ai.scope=${aiScope ?? '(none)'} parsed.type=${parsed.type ?? '(none)'} parsed.scope=${parsed.scope ?? '(none)'} -> initial.type=${type ?? '(none)'} initial.scope=${(scope || undefined) ?? '(none)'} `);
        // If AI didn't supply a valid type, use recommendation. Do not override valid AI types.
        let typeDecisionReason;
        if (!type || !allowedTypes.has(type)) {
            type = recommendedType;
            typeDecisionReason = !originalType ? 'filled missing type from recommendation' : `invalid type '${originalType}' replaced by recommendation`;
        }
        if (typeDecisionReason && type !== originalType) {
            core.info(`[Title] Type updated: ${originalType ?? '(none)'} -> ${type} (${typeDecisionReason})`);
        }
        // Scope: apply recommendation only when missing
        let scopeDecisionReason;
        if (!scope && recommendedScope) {
            scope = recommendedScope || undefined;
            scopeDecisionReason = 'filled missing scope from changed files';
        }
        if (scopeDecisionReason && (scope || undefined) !== originalScope) {
            core.info(`[Title] Scope updated: ${originalScope ?? '(none)'} -> ${scope} (${scopeDecisionReason})`);
        }
        // Strip trailing issue references within subject as a safeguard
        bareSubject = bareSubject.replace(/\s*#\d+\s*$/g, '').trim();
        bareSubject = this.toImperativeWithLog(bareSubject);
        const prefix = `${type}${scope ? `(${scope})` : ''}: `;
        // Enforce Conventional Commits guidance (<= 72 chars total)
        const allowedSubjectLen = Math.max(0, this.rules.titleMaxLen - prefix.length);
        let finalSubject = bareSubject.length > allowedSubjectLen ? this.shortenSubject(bareSubject, allowedSubjectLen) : bareSubject;
        finalSubject = finalSubject.replace(/[\.!?]+$/g, '');
        // Emoji enforcement in title
        let finalTitle;
        if (this.rules.allowTitleEmojis) {
            const allowed = this.rules.titleEmojis || [];
            const found = this.findFirstAllowedEmoji(subject, allowed);
            const chosen = found || this.pickEmojiForTypeFromAllowed(type, allowed) || allowed[0];
            const cleanSubject = this.removeAllEmojis(finalSubject).trim();
            finalTitle = (chosen ? `${chosen} ${prefix}${cleanSubject}` : `${prefix}${cleanSubject}`);
        }
        else {
            // Strip any emojis entirely
            finalTitle = `${prefix}${this.removeAllEmojis(finalSubject).trim()}`;
        }
        core.debug(`[Title] format -> final ${JSON.stringify({ type, scope, prefix, allowedSubjectLen, finalSubject, finalTitle })}`);
        return finalTitle;
    }
    stripLeadingConventionalPrefix(s) {
        if (!s)
            return s;
        // Remove optional leading emojis and a conventional prefix like feat(scope):
        const re = /^(?:\p{Extended_Pictographic}+\s*)?(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(?:\([^)]*\))?:\s*/iu;
        return s.replace(re, '').trim();
    }
    removeAllEmojis(s) {
        if (!s)
            return s;
        // Remove extended pictographic chars (covers most emojis) and VS16/ZWJ remnants
        return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0E\uFE0F\u200D]/g, '');
    }
    findFirstAllowedEmoji(s, allowed) {
        if (!s || !allowed?.length)
            return undefined;
        let bestIdx = Number.POSITIVE_INFINITY;
        let best;
        for (const e of allowed) {
            const idx = s.indexOf(e);
            if (idx >= 0 && idx < bestIdx) {
                bestIdx = idx;
                best = e;
            }
        }
        return best;
    }
    pickEmojiForTypeFromAllowed(type, allowed) {
        if (!allowed?.length)
            return undefined;
        const prefer = (...candidates) => candidates.find(c => allowed.includes(c));
        switch ((type || '').toLowerCase()) {
            case 'feat': return prefer('✨', '🚀');
            case 'fix': return prefer('🐛', '🩹');
            case 'docs': return prefer('📝');
            case 'refactor': return prefer('♻️');
            case 'perf': return prefer('⚡️');
            case 'style': return prefer('💄', '🎨');
            case 'test': return prefer('✅', '🧪');
            case 'build': return prefer('🏗️', '🔧', '📦️');
            case 'ci': return prefer('👷', '🔧');
            case 'chore': return prefer('🧹', '🔧');
            default: return allowed[0];
        }
    }
    /**
     * Attempts to shorten a subject line more intelligently than a hard slice.
     */
    shortenSubject(subject, maxLen) {
        let s = subject.trim();
        // Remove trailing issue refs and surrounding spaces
        s = s.replace(/\s*#\d+\s*$/g, '').trim();
        // Remove parenthetical asides inside subject if present
        if (s.length > maxLen)
            s = s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        // Drop common stop-words if still too long
        const stopWords = new Set(['the', 'a', 'an', 'initial', 'basic', 'simple', 'various', 'misc', 'minor']);
        if (s.length > maxLen) {
            const parts = s.split(/\s+/);
            const filtered = [];
            for (const w of parts) {
                if (!stopWords.has(w.toLowerCase()))
                    filtered.push(w);
                if (filtered.join(' ').length >= maxLen)
                    break;
            }
            const joined = filtered.join(' ').trim();
            if (joined.length > 0)
                s = joined;
        }
        // Fallback to hard cut if still too long
        if (s.length > maxLen)
            s = s.slice(0, maxLen).trim();
        return s;
    }
    /** Executes the full update workflow: diff -> AI generation -> format -> GitHub updates. */
    async run() {
        try {
            // Validate the event context
            this.validateEventContext();
            // Extract pull request details
            const prCtx = this.getPullRequestFromContext();
            const pullRequestNumber = prCtx.number;
            const creator = prCtx.user.login;
            const { baseBranch, headBranch } = this.extractBranchRefs();
            // Set up Git configuration and fetch branches
            this.gitHelper.setupGitConfiguration();
            await this.gitHelper.fetchGitBranches(baseBranch, headBranch);
            // Get the diff and generate PR content (title + description)
            core.startGroup('Diff and Prompt');
            const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
            core.info(`[PR-Description] diff length=${diffOutput.length}`);
            const changedFiles = this.gitHelper.getChangedFiles(baseBranch, headBranch);
            core.debug(`[Title] changed files ${JSON.stringify({ count: changedFiles.length, files: changedFiles })}`);
            core.endGroup();
            core.startGroup('AI Generation');
            core.info('[PR] calling AI to generate title and description...');
            const currentTitle = prCtx.title || '';
            //const diffForPrompt = diffOutput.length > 50000 ? this.buildDiffSummary(changedFiles, diffOutput) : diffOutput;
            const content = await this.aiHelper.generatePullRequestContent(diffOutput, { currentTitle, creator, rules: this.rules });
            core.info('[PR] AI generation completed!');
            core.info(`[PR] AI title length: titleLength=${content.title.length}`);
            core.info(`[PR] AI PR title before formatting: ${content.title}`);
            core.info(`[PR] AI meta: type=${content.meta?.type ?? '(none)'} scope=${content.meta?.scope ?? '(none)'} subject=${content.meta?.subject ?? '(none)'} `);
            core.info(`[PR] AI description length: descriptionLength=${content.description.length}`);
            core.info(`[PR] AI description:\n${content.description}\n\n`);
            core.endGroup();
            // Compute final Conventional Commit title from AI output and local inference
            let generatedTitle;
            const baseTitleForFormatting = (content.title || content.meta?.subject || '').trim();
            const formatted = this.formatConventionalCommitTitle(baseTitleForFormatting, diffOutput, changedFiles, currentTitle, content.meta?.type, content.meta?.scope);
            core.info(`[PR] [Formatter/Title] formatted title length: formattedTitleLength=${formatted.length}\n`);
            core.info(`[PR] [Formatter/Title] generated title after formatting: ${formatted}`);
            if (this.updateTitle)
                generatedTitle = formatted;
            // Update the pull request description
            core.startGroup('PR Update');
            core.info(`[PR-Description] updating pull request #${pullRequestNumber}`);
            await this.updatePullRequestDescription(pullRequestNumber, content.description, generatedTitle);
            core.endGroup();
            // Set outputs for GitHub Actions
            (0, core_1.setOutput)('pr_number', pullRequestNumber.toString());
            (0, core_1.setOutput)('description', content.description);
            core.info(`Successfully updated PR #${pullRequestNumber} description.`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            core.setFailed(errorMessage);
        }
    }
    /** Validates that the current action is triggered by a pull_request event. */
    validateEventContext() {
        if (this.context.eventName !== 'pull_request') {
            (0, core_1.setFailed)('This action should only runs on pull_request events.');
            throw new Error('Invalid event context');
        }
    }
    /** Extracts base/head branch names from the action context for the current PR. */
    extractBranchRefs() {
        const prCtx = this.getPullRequestFromContext();
        const baseBranch = prCtx.base.ref;
        const headBranch = prCtx.head.ref;
        core.info(`Base branch: ${baseBranch}`);
        core.info(`Head branch: ${headBranch}`);
        return { baseBranch, headBranch };
    }
    async updatePullRequestDescription(pullRequestNumber, generatedDescription, generatedTitle) {
        try {
            // Fetch pull request details
            const pullRequest = await this.fetchPullRequestDetails(pullRequestNumber);
            const currentDescription = pullRequest.body || '';
            const currentTitle = pullRequest.title || '';
            // Post a comment with the original description if it exists
            if (currentDescription) {
                await this.postOriginalPullRequestComment(pullRequestNumber, currentTitle, currentDescription);
            }
            core.info(`[PR-Description] will apply new description prev=${currentDescription.length} new=${generatedDescription.length}`);
            core.info(`[PR-Description] new description content:\n${generatedDescription}`);
            // Apply the new pull request description
            await this.applyPullRequestUpdate(pullRequestNumber, generatedDescription, generatedTitle);
        }
        catch (error) {
            // Log the error and rethrow it for higher-level handling
            core.error(`Error updating PR #${pullRequestNumber} description: ${error.message}`);
            throw error;
        }
    }
    ;
    /**
     * Safely extracts the pull_request payload the action was triggered with.
     * Throws if required fields are missing.
     */
    getPullRequestFromContext() {
        const pr = this.context?.payload?.pull_request;
        if (!pr || typeof pr.number !== 'number' || !pr.user?.login || !pr.base?.ref || !pr.head?.ref) {
            throw new Error('Missing or invalid pull_request context payload');
        }
        return pr;
    }
    /** Fetches the current PR details (title/body) from GitHub. */
    async fetchPullRequestDetails(pullRequestNumber) {
        const { data } = await this.octokit.rest.pulls.get({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            pull_number: pullRequestNumber,
        });
        // Normalize potential nulls from the API into undefined
        return { title: data.title ?? undefined, body: data.body ?? undefined };
    }
    /** Posts a comment preserving the original PR title and description. */
    async postOriginalPullRequestComment(pullRequestNumber, currentTitle, currentDescription) {
        core.info('Creating comment with original title and description...');
        await this.octokit.rest.issues.createComment({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            issue_number: pullRequestNumber,
            body: `**Original title**: ${currentTitle}\n\n**Original description**:\n\n${currentDescription}`
        });
        core.info('Comment created successfully.');
    }
    /** Applies the new PR description (and optional title) to GitHub. */
    async applyPullRequestUpdate(pullRequestNumber, newDescription, newTitle) {
        core.info(`Updating PR description${newTitle ? 'and title' : ''}...`);
        const params = {
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            pull_number: pullRequestNumber,
            body: newDescription,
        };
        if (newTitle && newTitle.length > 0) {
            core.info(`Updating PR title to: "${newTitle}"`);
            params.title = newTitle;
        }
        await this.octokit.rest.pulls.update(params);
        core.info("PR description updated successfully.");
    }
    /** Builds a compact summary string for very large diffs to keep prompts small. */
    buildDiffSummary(files, _diff) {
        const total = files.length;
        const topLevel = {};
        for (const f of files) {
            const top = (f.split('/').filter(Boolean)[0] || 'root');
            topLevel[top] = (topLevel[top] || 0) + 1;
        }
        const topBuckets = Object.entries(topLevel)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        const maxList = 50;
        const listed = files.slice(0, maxList).join('\n');
        const more = total > maxList ? `\n... and ${total - maxList} more files` : '';
        return [
            'Summary of changes (diff omitted due to size):',
            `Files changed: ${total}`,
            `Top folders: ${topBuckets}`,
            '',
            'Changed file paths:',
            listed + more,
        ].join('\n');
    }
}
exports.default = PullRequestUpdater;
