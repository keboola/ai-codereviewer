# AI Code Reviewer

AI Code Reviewer is a GitHub Action that leverages multiple AI providers (OpenAI, Anthropic, Google) to provide intelligent feedback and suggestions on your pull requests. This powerful tool helps improve code quality and saves developers time by automating the code review process.

## Features

- Supports multiple AI providers:
  - OpenAI (ChatGPT)
  - Anthropic (Claude)
  - Google (Gemini)
- Provides intelligent comments and suggestions for improving your code
- Reviews only new changes in PR updates
- Filters out files that match specified exclude patterns
- Easy to set up and integrate into your GitHub workflow

## Setup

1. Choose your preferred AI provider and get an API key:
   - [OpenAI](https://platform.openai.com/api-keys)
   - [Anthropic](https://console.anthropic.com/account/keys)
   - [Google AI](https://makersuite.google.com/app/apikey)

2. Add the API key as a GitHub Secret in your repository:
   - `OPENAI_API_KEY` for OpenAI
   - `ANTHROPIC_API_KEY` for Claude
   - `GOOGLE_AI_KEY` for Google Gemini

3. Create `.github/workflows/code-review.yml`:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, labeled]

permissions: write-all

concurrency:
  group: code-review-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    # Run when:
    #   - the "ai-review" label was just applied (manual re-trigger), OR
    #   - mode is "auto" (default) and the PR is not a draft (or drafts are explicitly allowed).
    if: >-
      (github.event.action == 'labeled' && github.event.label.name == 'ai-review')
      || (
        github.event.action != 'labeled'
        && (vars.AI_REVIEW_MODE == 'auto' || vars.AI_REVIEW_MODE == '')
        && (
          github.event.pull_request.draft == false
          || vars.AI_REVIEW_INCLUDE_DRAFTS == 'true'
        )
      )
    steps:
      - uses: actions/checkout@v4

      - name: AI Code Review
        uses: keboola/ai-code-reviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

          # Choose your AI provider and key
          AI_PROVIDER: "openai" # or "anthropic" or "google"
          AI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          AI_MODEL: "gpt-4o-mini"
          AI_TEMPERATURE: 0.3 # 0 to 1 - higher values = more creativity and variance

          # Optional configurations
          APPROVE_REVIEWS: true
          APPROVE_CONFIDENCE_THRESHOLD: 80 # 0-100; only auto-approve when confidence >= this
          MAX_COMMENTS: 10 # 0 to disable
          MIN_COMMENT_SEVERITY: minor # blocker | major | minor | nit
          PROJECT_CONTEXT: "This is a Node.js TypeScript project"
          CONTEXT_FILES: "package.json,README.md"
          EXCLUDE_PATTERNS: "**/*.lock,**/*.json,**/*.md"

      - name: Remove ai-review label after re-trigger
        if: always() && github.event.action == 'labeled' && github.event.label.name == 'ai-review'
        uses: actions/github-script@v7
        with:
          script: |
            try {
              await github.rest.issues.removeLabel({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                name: 'ai-review',
              });
            } catch (e) {
              core.warning(`Could not remove label: ${e.message}`);
            }
```

### Trigger modes

Configure via Actions **repository variables** (`Settings → Secrets and variables → Actions → Variables`):

| Variable | Values | Default | Effect |
|---|---|---|---|
| `AI_REVIEW_MODE` | `auto`, `label` | `auto` | `auto` runs on every non-draft PR. `label` only runs when the `ai-review` label is applied. |
| `AI_REVIEW_INCLUDE_DRAFTS` | `true`, `false` | `false` | When `true` and `AI_REVIEW_MODE=auto`, drafts are also reviewed. |

Regardless of mode, applying the `ai-review` label to any PR always triggers a fresh review. The label is removed automatically when the run finishes — apply it again to re-review.

## Configuration

| Input | Description | Default |
|-------|-------------|---------|
| `AI_PROVIDER` | AI provider to use (`openai`, `anthropic`, `google`) | `openai` |
| `AI_API_KEY` | API key for chosen provider | Required |
| `AI_MODEL` | Model to use (see supported models below) | Provider's default |
| `AI_TEMPERATURE` | Temperature for AI model | `0` |
| `APPROVE_REVIEWS` | Whether to approve PRs automatically | `true` |
| `APPROVE_CONFIDENCE_THRESHOLD` | Minimum AI confidence (0-100) required to auto-approve. Below this, an `approve` verdict is downgraded to `comment`. Any surviving `blocker` comment forces `request_changes` regardless. | `80` |
| `MAX_COMMENTS` | Maximum number of review comments | `0` |
| `MIN_COMMENT_SEVERITY` | Drop comments below this severity. One of `blocker`, `major`, `minor`, `nit`. | `minor` |
| `PROJECT_CONTEXT` | Project context for better reviews | `""` |
| `CONTEXT_FILES` | Files to include in review (comma-separated) | `"package.json,README.md"` |
| `EXCLUDE_PATTERNS` | Files to exclude (glob patterns, comma-separated) | `"**/*.lock,**/*.json,**/*.md"` |

### Supported Models

All models supported by the provider should be supported.

## Development

```bash
# Install dependencies
yarn install

# Build TypeScript files
yarn build

# Run unit tests
yarn test

# Package for distribution
yarn package

# Generate test PR payload (for e2e testing)
yarn generate-pr-payload <owner> <repo> <pr_number>

# Run end-to-end tests
yarn test:e2e <owner> <repo> <pr_number>
```

### Testing Locally

To test the action locally:

1. Create a `.env` file with your credentials:
```env
GITHUB_TOKEN=your_github_token
AI_PROVIDER=openai  # or anthropic, google
AI_API_KEY=your_api_key
AI_MODEL=your_preferred_model
```

2. Generate a test PR payload:
```bash
yarn generate-pr your-org your-repo 123
```

3. Run the e2e test:
```bash
yarn test:e2e your-repo 123
```

Note: Make sure you have write access to the repository you're testing with.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see [LICENSE](LICENSE) for details.
