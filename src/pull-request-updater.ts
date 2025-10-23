import * as core from '@actions/core';
import { getInput, setFailed, setOutput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import aiHelperResolver from './ai/ai-helper-resolver';
import { AIHelperInterface } from './ai/types';
import { GitHelper } from './git-helper';

class PullRequestUpdater {
  private gitHelper: GitHelper;
  private context: any;
  private aiHelper: AIHelperInterface;
  private octokit: any;

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
  }

  private previewStr(text: string, max = 400): string {
    try { return (text || '').slice(0, max).replace(/\n/g, '\\n'); } catch { return ''; }
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
      core.startGroup('Diff and Prompt');
      const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
      core.info(`[PR-Description] diff length=${diffOutput.length}`);
      const prompt = this.generatePrompt(diffOutput, creator);
      core.info(`[PR-Description] prompt length=${prompt.length}`);
      core.endGroup();
      core.startGroup('AI Generation');
      core.info('[PR-Description] calling AI to generate description');
      const generatedDescription = await this.aiHelper.createPullRequestDescription(diffOutput, prompt);
      core.info(`[PR-Description] AI description length=${generatedDescription.length}`);
      core.info(`[PR-Description] AI description content=${generatedDescription.replace(/\n/g, '\\n')}`);
      core.endGroup();

      // Update the pull request description
      core.startGroup('PR Update');
      core.info(`[PR-Description] updating pull request #${pullRequestNumber}`);
      await this.updatePullRequestDescription(pullRequestNumber, generatedDescription);
      core.endGroup();

      // Set outputs for GitHub Actions
      setOutput('pr_number', pullRequestNumber.toString());
      setOutput('description', generatedDescription);
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

  async updatePullRequestDescription(pullRequestNumber: number, generatedDescription: string) {
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
      core.info(`[PR-Description] new description content=${generatedDescription.replace(/\n/g, '\\n')}`);
      // Apply the new pull request description
      await this.applyPullRequestUpdate(pullRequestNumber, generatedDescription);
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
    return this.context.payload.pull_request.head.ref.replace('feat/', '').replace('fix/', '');
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

  async applyPullRequestUpdate(pullRequestNumber: number, newDescription: string) {
    core.info('Updating PR description...');
    await this.octokit.rest.pulls.update({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: pullRequestNumber,
      body: newDescription,
    });
    core.info('PR description updated successfully.');
  }
}

export default PullRequestUpdater;
