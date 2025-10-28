import * as core from '@actions/core';
import { getInput, setFailed, setOutput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import aiHelperResolver from '../../core/resolver';
import { AIHelperInterface } from '../../core/types';
import { GitHelper } from '../../integrations/github/git.helper';
class PullRequestUpdater {
  private gitHelper: GitHelper;
  private context: any;
  private aiHelper: AIHelperInterface;
  private octokit: any;
  private updateTitle: boolean;

  constructor() {
    this.gitHelper = new GitHelper(getInput('ignores'));
    this.context = context;

    const aiName = getInput('ai_name', { required: true }).trim().toLowerCase().replace('open-ai', 'openai');
    const model = (getInput('ai_model') || '').trim() || (aiName === 'openai' ? 'gpt-4.1' : 'gemini-2.5-flash');
    const apiKey = getInput('api_key', { required: true }).trim();
    const temperature = Number.parseFloat(getInput('temperature') || '0.8');

    this.aiHelper = aiHelperResolver({ apiKey, aiName, temperature, model });
    core.info(`[PR-Description] AI configured provider=${aiName} model=${model} temperature=${temperature}`);
    
    const githubToken = getInput('github_token', { required: true }).trim();
    this.octokit = getOctokit(githubToken);
    this.updateTitle = (getInput("update_title") || '').toLowerCase() === 'true';

  }

  private previewStr(text: string, max = 400): string {
    try { return (text || '').slice(0, max).replace(/\n/g, '\\n'); } catch { return ''; }
  }

  private sanitizeTitle(title: string): string {
    const cleaned = (title || '')
      .replace(/^#+\s*/, '') // strip markdown heading
      .replace(/^[`'"]+|[`'"]+$/g, '') // strip surrounding quotes/backticks
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\.!?]+$/g, ''); // strip trailing punctuation
    // return cleaned.length > 72 ? cleaned.slice(0, 72).trim() : cleaned;
    return cleaned;
  }

  private parseConventionalCommit(title: string): { type?: string; scope?: string; subject: string } {
    const re = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(?:\(([^)]+)\))?:\s*(.+)$/i;
    const m = title.match(re);
    if (m) {
      return { type: m[1].toLowerCase(), scope: m[2], subject: (m[3] || '').trim() };
    }
    return { subject: title.trim() };
  }

  private parseConventionalCommitWithLog(title: string): { type?: string; scope?: string; subject: string } {
    const parsed = this.parseConventionalCommit(title);
    console.log('[Title] parse', { input: title, parsed });
    return parsed;
  }

  private chooseScopeFromFiles(files: string[]): string | undefined {
    if (!files || files.length === 0) return undefined;

    const candidates: Record<string, number> = {};
    const bump = (k?: string) => {
      if (!k) return;
      candidates[k] = (candidates[k] || 0) + 1;
    };

    for (const f of files) {
      const parts = f.split('/').filter(Boolean);
      if (parts[0] === '.github') { bump('ci'); continue; }
      if (parts.length === 1) {
        bump('root');
        continue;
      }
      if (parts[0] === 'apps' && parts[1]) { bump(parts[1]); continue; }
      if (parts[0] === 'packages' && parts[1]) { bump(parts[1]); continue; }
      if (['backend','frontend','server','client','api','web','app'].includes(parts[0])) { bump(parts[0]); continue; }
      if (parts[0] === 'src' && parts[1]) { bump(parts[1]); continue; }
      bump(parts[0]);
    }

    let best: string | undefined;
    let bestCount = 0;
    for (const [k, v] of Object.entries(candidates)) {
      if (v > bestCount) { best = k; bestCount = v; }
    }
    if (!best) return undefined;

    const total = files.length;
    if (bestCount / total < 0.5 || Object.keys(candidates).length > 3) {
      return 'monorepo';
    }
    if (best === 'root') return 'repo';
    return best;
  }

  private chooseScopeFromFilesWithMonorepo(files: string[]): string | undefined {
    if (!files || files.length === 0) return undefined;
    const hasApps = files.some(f => /^apps\//.test(f));
    const hasPackages = files.some(f => /^packages\//.test(f));
    const hasBackend = files.some(f => /(^|\/)backend(\/|$)/.test(f));
    const hasFrontend = files.some(f => /(^|\/)frontend(\/|$)/.test(f));
    const hasMonorepoFiles = files.some(f => /(^|\/)pnpm-workspace\.ya?ml$|(^|\/)turbo\.json$/.test(f));

    // Reuse existing logic for candidate scoring
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
      console.log('[Title] scope -> monorepo', { total, best, bestCount, candidates, hasApps, hasPackages, hasBackend, hasFrontend, hasMonorepoFiles });
      return 'monorepo';
    }
    if (best === 'root') return 'repo';
    console.log('[Title] scope -> best', { scope: best, total, bestCount, candidates });
    return best;
  }

  private toImperative(subject: string): string {
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

  private toImperativeWithLog(subject: string): string {
    const result = this.toImperative(subject);
    if (result !== subject) {
      console.log('[Title] imperative', { before: subject, after: result });
    }
    return result;
  }

  private inferCommitType(diffOutput: string, files: string[], currentTitle: string, subject: string): string {
    const lowerAll = (s: string) => (s || '').toLowerCase();
    const d = lowerAll(diffOutput);
    const t = lowerAll(currentTitle + ' ' + subject);

    const isDocsFile = (f: string) => /(^docs\/|\.md$|README\.[^/]*$)/i.test(f);
    const isTestFile = (f: string) => /(\.test\.|\.spec\.|__tests__\/|^tests\/)/i.test(f);
    const isCiFile = (f: string) => /(^\.github\/|^\.circleci\/|gitlab-ci\.yml$|azure-pipelines\.yml$)/i.test(f);
    const isBuildFile = (f: string) => /(^Dockerfile$|docker-compose|^turbo\.json$|^pnpm-workspace\.ya?ml$|^package\.json$|^vite\.config|^webpack\.config|^rollup\.config|^tsconfig\.json$|babel|^Makefile$)/i.test(f);
    const isStyleFile = (f: string) => /(\.css$|\.scss$|\.sass$|\.less$)/i.test(f);
    const isCodeFile = (f: string) => /(\.ts$|\.tsx$|\.js$|\.jsx$|\.py$|\.go$|\.rb$|\.rs$|\.java$|\.php$)/i.test(f);

    const every = (pred: (f: string) => boolean) => files.length > 0 && files.every(pred);
    const some = (pred: (f: string) => boolean) => files.some(pred);

    if (files.length > 0) {
      if (every(isDocsFile)) return 'docs';
      if (every(isTestFile)) return 'test';
      if (every(isCiFile)) return 'ci';
      if (every(isBuildFile)) return 'build';
      if (every(isStyleFile)) return 'style';
    }

    if (/\bfix(e[sd]|ing)?\b|\bbug\b|\berror\b|\bissue\b|\bcorrect\b/.test(d) || /\bfix\b/.test(t)) {
      return 'fix';
    }
    if (/\brefactor(ing|ed|s)?\b|\bcleanup\b|\brename\b|\brestructure\b/.test(d) || /\brefactor\b/.test(t)) {
      return 'refactor';
    }
    if (/\bperf(ormance)?\b|\boptimi[sz]e\b|\bfaster\b|\bspeed\b/.test(d + ' ' + t)) {
      return 'perf';
    }

    if (some(isCiFile) && !some(isCodeFile)) return 'ci';
    if (some(isBuildFile) && !some(isCodeFile)) return 'build';
    if (some(isDocsFile) && !some(isCodeFile)) return 'docs';
    if (some(isTestFile) && !some(isCodeFile)) return 'test';

    if (some(isCodeFile)) return 'feat';
    return 'chore';
  }

  private inferCommitTypeScored(diffOutput: string, files: string[], currentTitle: string, subject: string): string {
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
    const add = (k: string, n: number, reason: string) => { scores[k] += n; console.log(`[Title] score +${n} => ${k} :: ${reason}`); };

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
      console.log('[Title] adjust type: fix -> feat due to broader signals');
      bestType = 'feat';
    }
    if (bestType === 'chore' && some(isCodeFile)) bestType = 'feat';

    console.log('[Title] infer (scored) -> result', { bestType, scores });
    return bestType;
  }

  private formatConventionalCommitTitle(subject: string, diffOutput: string, files: string[], currentTitle: string): string {
    const parsed = this.parseConventionalCommitWithLog(subject);
    let type = parsed.type;
    let scope = parsed.scope;
    let bareSubject = parsed.type ? parsed.subject : subject;

    console.log('[Title] format -> initial', { subject, parsed, currentTitle });

    if (!type) {
      type = this.inferCommitTypeScored(diffOutput, files, currentTitle, bareSubject);
    }
    if (!scope) {
      scope = this.chooseScopeFromFilesWithMonorepo(files) || undefined;
    }

    // Strip trailing issue references within subject as a safeguard
    bareSubject = bareSubject.replace(/\s*#\d+\s*$/g, '').trim();
    bareSubject = this.toImperativeWithLog(bareSubject);

    const prefix = `${type}${scope ? `(${scope})` : ''}: `;
    const maxLen = 72;
    const allowedSubjectLen = Math.max(0, maxLen - prefix.length);
    let finalSubject = bareSubject.length > allowedSubjectLen ? bareSubject.slice(0, allowedSubjectLen).trim() : bareSubject;
    finalSubject = finalSubject.replace(/[\.!?]+$/g, '');
    const finalTitle = `${prefix}${finalSubject}`;
    console.log('[Title] format -> final', { type, scope, prefix, allowedSubjectLen, finalSubject, finalTitle });
    return finalTitle;
  }

  async run() {
    try {
      // Validate the event context
      this.validateEventContext();

      // Extract pull request details
      const pullRequestNumber = this.context.payload.pull_request.number;
      const creator = this.context.payload.pull_request.user.login;
      const { baseBranch, headBranch } = this.extractBranchRefs();

      // Set up Git configuration and fetch branches
      this.gitHelper.setupGitConfiguration();
      await this.gitHelper.fetchGitBranches(baseBranch, headBranch);

      // Get the diff and generate PR content (title + description)
      core.startGroup('Diff and Prompt');
      const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
      core.info(`[PR-Description] diff length=${diffOutput.length}`);
      const changedFiles = this.gitHelper.getChangedFiles(baseBranch, headBranch);
      console.log('[Title] changed files', { count: changedFiles.length, files: changedFiles });
      core.endGroup();
      core.startGroup('AI Generation');
      core.info('[PR] calling AI to generate title and description');
      const currentTitle = this.context.payload.pull_request.title || '';
      const content = await this.aiHelper.generatePullRequestContent(diffOutput, { currentTitle, creator });
      core.info(`[PR] AI content lengths: title=${content.title.length} description=${content.description.length}`);
      core.info(`[PR] AI description content:\n${content.description}`);
      core.endGroup();

      // Compute final Conventional Commit title from AI output and local inference
      let generatedTitle: string | undefined;
      const baseTitleForFormatting = (content.title || content.meta?.subject || '').trim();
      const formatted = this.formatConventionalCommitTitle(baseTitleForFormatting, diffOutput, changedFiles, currentTitle);
      core.info(`[Title] generated title (formatted) ${formatted}`);
      if (this.updateTitle) generatedTitle = formatted;

      // Update the pull request description
      core.startGroup('PR Update');
      core.info(`[PR-Description] updating pull request #${pullRequestNumber}`);
      await this.updatePullRequestDescription(
      pullRequestNumber,
      content.description,
      generatedTitle
      );
      core.endGroup();

      // Set outputs for GitHub Actions
      setOutput('pr_number', pullRequestNumber.toString());
      setOutput('description', content.description);
      core.info(`Successfully updated PR #${pullRequestNumber} description.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      core.setFailed(errorMessage);
    }
  }

  validateEventContext() {
    if (this.context.eventName !== 'pull_request') {
      setFailed('This action should only runs on pull_request events.');
      throw new Error('Invalid event context');
    }
  }

  extractBranchRefs() {
    const baseBranch = this.context.payload.pull_request.base.ref;
    const headBranch = this.context.payload.pull_request.head.ref;
    core.info(`Base branch: ${baseBranch}`);
    core.info(`Head branch: ${headBranch}`);
    return { baseBranch, headBranch };
  }

  async updatePullRequestDescription(
  pullRequestNumber: number,
  generatedDescription: string,
  generatedTitle?: string
  ) {
    try {
      // Fetch pull request details
      const pullRequest = await this.fetchPullRequestDetails(pullRequestNumber);
      const currentDescription = pullRequest.body || '';

      // Post a comment with the original description if it exists
      if (currentDescription) {
        await this.postOriginalDescriptionComment(
          pullRequestNumber,
          currentDescription
        );
      }

      core.info(`[PR-Description] will apply new description prev=${currentDescription.length} new=${generatedDescription.length}`);
      core.info(`[PR-Description] new description content:\n${generatedDescription}`);
      // Apply the new pull request description
      await this.applyPullRequestUpdate(
        pullRequestNumber,
        generatedDescription,
        generatedTitle
      );
    } catch (error) {
      // Log the error and rethrow it for higher-level handling
      core.error(`Error updating PR #${pullRequestNumber} description: ${(error as Error).message}`);
      throw error;
    }
  };

  async fetchPullRequestDetails(pullRequestNumber: number) {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: pullRequestNumber,
    });
    return data;
  }

  extractBranchName(): string {
    return this.context.payload.pull_request.head.ref
      .replace("feat/", "")
      .replace("fix/", "");
  }

  async postOriginalDescriptionComment(
    pullRequestNumber: number,
    currentDescription: string
  ) {
    core.info('Creating comment with original description...');
    await this.octokit.rest.issues.createComment({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      issue_number: pullRequestNumber,
      body: `**Original description**:\n\n${currentDescription}`
    });
    core.info('Comment created successfully.');
  }

  async applyPullRequestUpdate(
    pullRequestNumber: number,
    newDescription: string,
    newTitle?: string
  ) {
    core.info(`Updating PR description${newTitle ? 'and title' : ''}...`);
    const params: any = {
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
}

export default PullRequestUpdater;
