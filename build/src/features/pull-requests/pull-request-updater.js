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
    }
    previewStr(text, max = 400) {
        try {
            return (text || '').slice(0, max).replace(/\n/g, '\\n');
        }
        catch {
            return '';
        }
    }
    generatePrompt(diffOutput, creator) {
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
            core.info(`[PR-Description] AI description content:\n${generatedDescription}`);
            core.endGroup();
            // Update the pull request description
            core.startGroup('PR Update');
            core.info(`[PR-Description] updating pull request #${pullRequestNumber}`);
            await this.updatePullRequestDescription(pullRequestNumber, generatedDescription);
            core.endGroup();
            // Set outputs for GitHub Actions
            (0, core_1.setOutput)('pr_number', pullRequestNumber.toString());
            (0, core_1.setOutput)('description', generatedDescription);
            core.info(`Successfully updated PR #${pullRequestNumber} description.`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            core.setFailed(errorMessage);
        }
    }
    validateEventContext() {
        if (this.context.eventName !== 'pull_request') {
            (0, core_1.setFailed)('This action should only runs on pull_request events.');
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
    async updatePullRequestDescription(pullRequestNumber, generatedDescription) {
        try {
            // Fetch pull request details
            const pullRequest = await this.fetchPullRequestDetails(pullRequestNumber);
            const currentDescription = pullRequest.body || '';
            // Post a comment with the original description if it exists
            if (currentDescription) {
                await this.postOriginalDescriptionComment(pullRequestNumber, currentDescription);
            }
            core.info(`[PR-Description] will apply new description prev=${currentDescription.length} new=${generatedDescription.length}`);
            core.info(`[PR-Description] new description content:\n${generatedDescription}`);
            // Apply the new pull request description
            await this.applyPullRequestUpdate(pullRequestNumber, generatedDescription);
        }
        catch (error) {
            // Log the error and rethrow it for higher-level handling
            core.error(`Error updating PR #${pullRequestNumber} description: ${error.message}`);
            throw error;
        }
    }
    ;
    async fetchPullRequestDetails(pullRequestNumber) {
        const { data } = await this.octokit.rest.pulls.get({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            pull_number: pullRequestNumber,
        });
        return data;
    }
    extractBranchName() {
        return this.context.payload.pull_request.head.ref.replace('feat/', '').replace('fix/', '');
    }
    async postOriginalDescriptionComment(pullRequestNumber, currentDescription) {
        core.info('Creating comment with original description...');
        await this.octokit.rest.issues.createComment({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            issue_number: pullRequestNumber,
            body: `**Original description**:\n\n${currentDescription}`
        });
        core.info('Comment created successfully.');
    }
    async applyPullRequestUpdate(pullRequestNumber, newDescription) {
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
exports.default = PullRequestUpdater;
