import * as core from '@actions/core';

export const ALLOWED_COMMIT_TYPES = [
  'feat','fix','docs','style','refactor','perf','test','build','ci','chore',
] as const;

export type CommitType = typeof ALLOWED_COMMIT_TYPES[number];

export function parseConventionalCommit(title: string): { type?: CommitType; scope?: string; subject: string } {
  const typesAlt = ALLOWED_COMMIT_TYPES.join('|');
  const re = new RegExp(`^(${typesAlt})(?:\\(([^)]+)\\))?:\\s*(.+)$`, 'i');
  const m = title.match(re);
  if (m) {
    return { type: m[1].toLowerCase() as CommitType, scope: m[2], subject: (m[3] || '').trim() };
  }
  return { subject: (title || '').trim() };
}

export function parseConventionalCommitWithLog(title: string): { type?: CommitType; scope?: string; subject: string } {
  const parsed = parseConventionalCommit(title);
  core.debug(`[Title] parse ${JSON.stringify({ input: title, parsed })}`);
  return parsed;
}

export function chooseScopeFromFilesWithMonorepo(files: string[]): string | undefined {
  if (!files || files.length === 0) return undefined;
  const hasApps = files.some(f => /^apps\//.test(f));
  const hasPackages = files.some(f => /^packages\//.test(f));
  const hasBackend = files.some(f => /(^|\/)backend(\/|$)/.test(f));
  const hasFrontend = files.some(f => /(^|\/)frontend(\/|$)/.test(f));
  const hasMonorepoFiles = files.some(f => /(^|\/)pnpm-workspace\.ya?ml$|(^|\/)turbo\.json$/.test(f));

  const candidates: Record<string, number> = {};
  const bump = (k?: string) => { if (!k) return; candidates[k] = (candidates[k] || 0) + 1; };
  for (const f of files) {
    const parts = f.split('/').filter(Boolean);
    if (parts[0] === '.github') { bump('ci'); continue; }
    if (parts.length === 1) { bump('root'); continue; }
    if (parts[0] === 'apps' && parts[1]) { bump(parts[1]); continue; }
    if (parts[0] === 'packages' && parts[1]) { bump(parts[1]); continue; }
    if (['backend','frontend','server','client','api','web','app'].includes(parts[0])) { bump(parts[0]); continue; }
    if (parts[0] === 'src' && parts[1]) { bump(parts[1]); continue; }
    bump(parts[0]);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [k, v] of Object.entries(candidates)) { if (v > bestCount) { best = k; bestCount = v; } }
  if (!best) return undefined;

  const total = files.length;
  const manyAreas = Object.keys(candidates).length > 3 || (hasApps && hasPackages) || (hasBackend && hasFrontend);
  if (bestCount / total < 0.5 || manyAreas || hasMonorepoFiles) {
    core.debug(`[Title] scope -> monorepo ${JSON.stringify({ total, best, bestCount, candidates, hasApps, hasPackages, hasBackend, hasFrontend, hasMonorepoFiles })}`);
    return 'monorepo';
  }
  if (best === 'root') return 'repo';
  core.debug(`[Title] scope -> best ${JSON.stringify({ scope: best, total, bestCount, candidates })}`);
  return best;
}

export function toImperative(subject: string): string {
  if (!subject) return subject;
  let s = subject.trim().replace(/\s+/g, ' ').replace(/[\.!?]+$/g, '');

  const wordRe = /(^|:\s*|\()([A-Za-z][\w'-]*)/;
  const m = s.match(wordRe);
  if (!m) return s;

  const startIdx = (m.index || 0) + m[1].length;
  const word = m[2];

  const lemmas: Record<string, string> = {
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

export function toImperativeWithLog(subject: string): string {
  const result = toImperative(subject);
  if (result !== subject) {
    core.debug(`[Title] imperative ${JSON.stringify({ before: subject, after: result })}`);
  }
  return result;
}

export function inferCommitTypeScored(diffOutput: string, files: string[], currentTitle: string, subject: string): CommitType | 'chore' {
  const lowerAll = (s: string) => (s || '').toLowerCase();
  const d = lowerAll(diffOutput);
  const t = lowerAll(currentTitle + ' ' + subject);

  const isDocsFile = (f: string) => /(^docs\/|\.md$|README\.[^/]*$)/i.test(f);
  const isTestFile = (f: string) => /(\.test\.|\.spec\.|__tests__\/|^tests\/)/i.test(f);
  const isCiFile = (f: string) => /(^\.github\/|^\.circleci\/|gitlab-ci\.yml$|azure-pipelines\.yml$)/i.test(f);
  const isBuildFile = (f: string) => /(^Dockerfile$|docker-compose|^turbo\.json$|^pnpm-workspace\.ya?ml$|^package\.json$|^vite\.config|^webpack\.config|^rollup\.config|^tsconfig\.json$|babel|^Makefile$)/i.test(f);
  const isStyleFile = (f: string) => /(\.css$|\.scss$|\.sass$|\.less$)/i.test(f);
  const isCodeFile = (f: string) => /(\.ts$|\.tsx$|\.js$|\.jsx$|\.py$|\.go$|\.rb$|\.rs$|\.java$|\.php$)/i.test(f);

  const some = (pred: (f: string) => boolean) => files.some(pred);

  const scores: Record<string, number> = { feat: 0, fix: 0, docs: 0, style: 0, refactor: 0, perf: 0, test: 0, build: 0, ci: 0, chore: 0 };
  const add = (k: string, n: number, reason: string) => { scores[k] += n; core.debug(`[Title] score +${n} => ${k} :: ${reason}`); };

  if (some(isCodeFile)) add('feat', 2, 'code changes present');
  if (some(isDocsFile)) add('docs', 2, 'docs files present');
  if (some(isTestFile)) add('test', 2, 'test files present');
  if (some(isCiFile))   add('ci',   some(isCodeFile) ? 1 : 3, 'ci files present');
  if (some(isBuildFile))add('build', some(isCodeFile) ? 2 : 3, 'build files present');
  if (some(isStyleFile))add('style', 2, 'style files present');

  const monorepoSignals = /turbo\.json|pnpm-workspace\.ya?ml|\bmonorepo\b|\bturbo\b/.test(d + ' ' + t) || files.some(f => /(^|\/)turbo\.json$|(^|\/)pnpm-workspace\.ya?ml$|^apps\//.test(f));
  if (monorepoSignals) { add('feat', 3, 'monorepo/turbo/pnpm signals'); add('build', 2, 'monorepo tooling changes'); }

  const addedFileSignals = (d.match(/\bcreate mode\b|\bnew file mode\b/g) || []).length;
  if (addedFileSignals >= 3) add('feat', 2, `many new files (${addedFileSignals})`);

  if (/\brefactor(ing|ed|s)?\b|\bcleanup\b|\brestructure\b|\brename\b/.test(d + ' ' + t)) add('refactor', 2, 'refactor keywords');
  if (/\bperf(ormance)?\b|\boptimi[sz]e\b|\bfaster\b|\bspeed\b/.test(d + ' ' + t)) add('perf', 2, 'performance keywords');

  const fixStrong = /\bfix(e[sd]|ing)?\b|\bbug\b|\berror\b|\bissue\b|\bcorrect\b/.test(d + ' ' + t);
  if (fixStrong) add('fix', 2, 'fix/bug keywords');

  let bestType: keyof typeof scores = 'chore';
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(scores)) { if (v > bestScore) { bestType = k as keyof typeof scores; bestScore = v; } }

  if (bestType === 'fix' && (monorepoSignals || addedFileSignals >= 3 || scores['feat'] >= scores['fix'] - 1)) {
    core.debug('[Title] adjust type: fix -> feat due to broader signals');
    bestType = 'feat';
  }
  if (bestType === 'chore' && some(isCodeFile)) bestType = 'feat';

  core.debug(`[Title] infer (scored) -> result ${JSON.stringify({ bestType, scores })}`);
  return bestType as CommitType | 'chore';
}

