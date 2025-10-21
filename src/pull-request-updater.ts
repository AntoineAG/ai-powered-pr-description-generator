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
      const prompt = this.generatePrompt(diffOutput, creator);
      const generatedDescription = await this.aiHelper.createPullRequestDescription(diffOutput, prompt);

      // Optionally generate a new PR title
      const currentTitle = this.context.payload.pull_request.title || '';
      let generatedTitle: string | undefined;
      if (this.updateTitle) {
        const titlePrompt = this.generateTitlePrompt(diffOutput, currentTitle);
        const rawTitle = await this.aiHelper.createPullRequestDescription(diffOutput, titlePrompt);
        generatedTitle = this.sanitizeTitle(rawTitle);
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
  }
  Ï;

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
