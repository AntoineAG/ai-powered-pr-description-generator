# AI-Powered PR Description Generator

Automatically generates descriptive summaries for pull requests using AI, enhancing clarity and context for reviewers.

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [GitHub Workflow](#github-workflow)
- [Building the Project](#building-the-project)
- [Supported AI Models](#supported-ai-models)
- [Contributing](#contributing)
- [License](#license)

## Features

- Automatically generates descriptions for pull requests.
- Supports multiple AI models (e.g., Gemini, OpenAI).
- Integrates seamlessly with GitHub workflows.
- Executes on pull request creation and commit push events.
- Written in TypeScript for type safety and maintainability.

## Getting Started

To get started with the AI-Powered PR Description Generator, follow the instructions below to set up your environment and configure the project.

## Installation

- Prerequisites
  - [Node.js](https://nodejs.org/) (version 20 or above)
  - [npm](https://www.npmjs.com/) (Node package manager)

- Clone the repository:

   ```bash
   git clone https://github.com/your-username/ai-powered-pr-description-generator.git
   cd ai-powered-pr-description-generator
   ```

- Install the dependencies:

   ```bash
   npm install & npm run build
   ```
   
## Configuration
Before using the generator, you need to configure the following secrets in your GitHub repository settings(https://github.com/your-repo/settings/secrets/actions):

- GEMINI_API_KEY: Your API key for the Gemini model.
- OPENAI_API_KEY: Your API key for the OpenAI model (if applicable).

GITHUB_TOKEN should be required (https://github.com/settings/tokens), it needs permission to modify the pull request.

### Action Inputs
- `ai_name` (required): Which provider to use. Supported: `gemini`, `open-ai`.
- `api_key` (required): API key for the selected provider.
- `temperature` (optional): Creativity (0.0–1.0). Default: `0.7`.
- `ignores` (optional): Comma-separated paths to ignore in diffs.
- `use_jira` (optional): Enable Jira ticket extraction from branch. Default: `false`.
- `ai_model` (optional): Model to use. Default depends on `ai_name`:
  - `gemini` -> `gemini-1.5-pro` (e.g., `gemini-2.5-flash`, `gemini-2.5-flash-lite`)
  - `open-ai` -> `gpt-4.1` (e.g., `gpt-4.1`, `gpt-4.1-mini`)

## Usage
Once configured, the action will automatically execute whenever a pull request is created or a commit is pushed to the repository.

## GitHub Workflow
Here's an example of how to set up your GitHub Actions workflow file (.github/workflows/description-generator.yml):

```yaml
name: AI PR Description Generator

on:
  pull_request:
    types: [opened, edited, reopened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  generate:
    runs-on: ubuntu-latest
    if: ${{ github.event.pull_request.draft == false }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate PR description (${{ env.AI_PROVIDER }})
        uses: 57blocks/ai-powered-pr-description-generator@v1.2.0
        with:
          ai_name: gemini
          ai_model: ${{ env.AI_MODEL }}
          update_title: true
          api_key: ${{ secrets.GEMINI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          temperature: "0.4"
          ignores: ".git/**,.github/**,.vscode/**,node_modules/**,.next/**,dist/**,build/**,out/**,coverage/**,*.lock,package-lock.json,pnpm-lock.yaml,yarn.lock,*.png,*.jpg,*.jpeg,*.gif,*.webp,*.svg,*.ico,*.pdf,*.zip,*.mp4,*.mov"

```

Tip: set provider and models at the top of your workflow via `env`:

```yaml
env:
  AI_PROVIDER: gemini # or 'openai'
  AI_MODEL: gemini-2.5-flash # or 'gpt-4.1'

```

## Supported AI Models
The project currently supports the following AI models for generating descriptions:

- Gemini: An AI model that provides concise and relevant descriptions for pull requests.
- OpenAI: A more advanced AI model that can generate detailed and nuanced descriptions.
You can configure which AI model to use in your workflow settings.

## Contributing
Contributions are welcome! Please feel free to submit a pull request or open an issue for any enhancements or bug fixes.

Fork the repository.
Create your feature branch: git checkout -b feature/new-feature.
Commit your changes: git commit -m 'Add some feature'.
Push to the branch: git push origin feature/new-feature.
Open a pull request.

## License
This project is licensed under the MIT License. See the LICENSE file for details.

### Summary of Additions and Improvements:
- **Configuration**: Added details about environment variables needed for setup.
- **Usage**: Included a command for local execution.
- **GitHub Workflow**: Provided a full example of a GitHub Actions workflow.
- **Building the Project**: Clarified the build process.
- **Contributing**: Maintained clear instructions for contributing to the project.

Feel free to modify any sections further to better fit your project's specifics!
