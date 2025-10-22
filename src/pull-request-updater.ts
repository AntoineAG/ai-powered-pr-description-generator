import { getInput, setFailed, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import aiHelperResolver from "./ai/ai-helper-resolver";
import { AIHelperInterface } from "./ai/types";
import { GitHelper } from "./git-helper";

class PullRequestUpdater {
  private gitHelper: GitHelper;
  private context: any;
  private aiHelper: AIHelperInterface;
  private octokit: any;
  private updateTitle: boolean;

  constructor() {
    this.gitHelper = new GitHelper(getInput("ignores"));
    this.context = context;
    this.aiHelper = aiHelperResolver({
      apiKey: getInput("api_key", { required: true }),
      aiName: getInput("ai_name", { required: true }),
      temperature: parseFloat(getInput("temperature") || "0.8"),
      geminiModel: getInput("gemini_model") || 'gemini-1.5-pro',
      openaiModel: getInput("openai_model") || 'gpt-4.1',
    });
    const githubToken = getInput("github_token", { required: true });
    this.octokit = getOctokit(githubToken);
    this.updateTitle = (getInput("update_title") || '').toLowerCase() === 'true';
  }

  private generatePrompt(diffOutput: string, creator: string): string {
    return `Instructions:
    Please generate a Pull Request description for the provided diff, following these guidelines:
    - Start with a subtitle "## What this PR does?".
    - Format your response in Markdown.
    - Exclude the PR title (e.g., "feat: xxx", "fix: xxx", "Refactor: xxx").
    - Do not include the diff in the PR description.
    - Provide a simple description of the changes.
    - Avoid code snippets or images.
    - Add some fun with emojis! Use only the following: 🚀🎉👍👏🔥. List changes using numbers, with a maximum of one emoji per item. Limit the total to 3 emojis. Example: 
      1. Added a new feature👏 
      2. Fixed a bug👍 
      3. Major refactor🚀.
    - Thank **${creator}** for the contribution! 🎉
  
    Diff:
    ${diffOutput}`;
  }

  private generateTitlePrompt(diffOutput: string, currentTitle: string): string {
    return `You are helping write a precise, concise Pull Request title.

Rules:
- Output ONLY the title text, nothing else.
- Use imperative mood, present tense.
- 6-12 words, max 72 characters.
- No emojis, no code fences, no quotes, no trailing punctuation.
- Summarize the main changes from the diff. If the current title is already great, improve it slightly.

Current title: ${currentTitle}

Diff:
${diffOutput}`;
  }

  private sanitizeTitle(title: string): string {
    const cleaned = (title || '')
      .replace(/^#+\s*/, '') // strip markdown heading
      .replace(/^[`'"]+|[`'"]+$/g, '') // strip surrounding quotes/backticks
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\.!?]+$/g, ''); // strip trailing punctuation
    return cleaned.length > 72 ? cleaned.slice(0, 72).trim() : cleaned;
  }

  private parseConventionalCommit(title: string): { type?: string; scope?: string; subject: string } {
    const re = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(?:\(([^)]+)\))?:\s*(.+)$/i;
    const m = title.match(re);
    if (m) {
      return { type: m[1].toLowerCase(), scope: m[2], subject: (m[3] || '').trim() };
    }
    return { subject: title.trim() };
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

  private formatConventionalCommitTitle(subject: string, diffOutput: string, files: string[], currentTitle: string): string {
    const parsed = this.parseConventionalCommit(subject);
    let type = parsed.type;
    let scope = parsed.scope;
    let bareSubject = parsed.type ? parsed.subject : subject;

    if (!type) {
      type = this.inferCommitType(diffOutput, files, currentTitle, bareSubject);
    }
    if (!scope) {
      scope = this.chooseScopeFromFiles(files) || undefined;
    }

    bareSubject = this.toImperative(bareSubject);

    const prefix = `${type}${scope ? `(${scope})` : ''}: `;
    const maxLen = 72;
    const allowedSubjectLen = Math.max(0, maxLen - prefix.length);
    let finalSubject = bareSubject.length > allowedSubjectLen ? bareSubject.slice(0, allowedSubjectLen).trim() : bareSubject;
    finalSubject = finalSubject.replace(/[\.!?]+$/g, '');
    return `${prefix}${finalSubject}`;
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

      // Get the diff and generate the PR description
      const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
      const changedFiles = this.gitHelper.getChangedFiles(baseBranch, headBranch);
      const prompt = this.generatePrompt(diffOutput, creator);
      const generatedDescription = await this.aiHelper.createPullRequestDescription(diffOutput, prompt);

      // Optionally generate a new PR title
      const currentTitle = this.context.payload.pull_request.title || '';
      let generatedTitle: string | undefined;
      if (this.updateTitle) {
        const titlePrompt = this.generateTitlePrompt(diffOutput, currentTitle);
        const rawTitle = await this.aiHelper.createPullRequestDescription(diffOutput, titlePrompt);
        const cleaned = this.sanitizeTitle(rawTitle);
        generatedTitle = this.formatConventionalCommitTitle(cleaned, diffOutput, changedFiles, currentTitle);
      }

      // Update the pull request description
      await this.updatePullRequestDescription(
        pullRequestNumber,
        generatedDescription,
        generatedTitle
      );

      // Set outputs for GitHub Actions
      setOutput("pr_number", pullRequestNumber.toString());
      setOutput("description", generatedDescription);

      console.log(`Successfully updated PR #${pullRequestNumber} description.`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setFailed(errorMessage);
      console.error(`Error updating PR: ${errorMessage}`);
    }
  }

  validateEventContext() {
    if (this.context.eventName !== "pull_request") {
      setFailed("This action should only runs on pull_request events.");
      throw new Error("Invalid event context");
    }
  }

  extractBranchRefs() {
    const baseBranch = this.context.payload.pull_request.base.ref;
    const headBranch = this.context.payload.pull_request.head.ref;
    console.log(`Base branch: ${baseBranch}`);
    console.log(`Head branch: ${headBranch}`);
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
      const currentDescription = pullRequest.body || "";

      // Post a comment with the original description if it exists
      if (currentDescription) {
        await this.postOriginalDescriptionComment(
          pullRequestNumber,
          currentDescription
        );
      }

      // Apply the new pull request description
      await this.applyPullRequestUpdate(
        pullRequestNumber,
        generatedDescription,
        generatedTitle
      );
    } catch (error) {
      // Log the error and rethrow it for higher-level handling
      console.error(
        `Error updating PR #${pullRequestNumber} description:`,
        error
      );
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
    console.log("Creating comment with original description...");
    await this.octokit.rest.issues.createComment({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      issue_number: pullRequestNumber,
      body: `**Original description**:\n\n${currentDescription}`,
    });
    console.log("Comment created successfully.");
  }

  async applyPullRequestUpdate(
    pullRequestNumber: number,
    newDescription: string,
    newTitle?: string
  ) {
    console.log("Updating PR description...");
    const params: any = {
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: pullRequestNumber,
      body: newDescription,
    };
    if (newTitle && newTitle.length > 0) {
      console.log(`Updating PR title to: "${newTitle}"`);
      params.title = newTitle;
    }
    await this.octokit.rest.pulls.update(params);
    console.log("PR description updated successfully.");
  }
}

export default PullRequestUpdater;
