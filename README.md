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
| `AI_BASE_URL` | Optional OpenAI-compatible endpoint override (e.g. `https://models.github.ai/inference` for GitHub Models). Affects only the `openai` provider. | `""` |
| `AI_MODEL` | Model to use (see supported models below) | Provider's default |
| `AI_TEMPERATURE` | Temperature for AI model | `0` |
| `APPROVE_REVIEWS` | Whether to approve PRs automatically | `true` |
| `APPROVE_CONFIDENCE_THRESHOLD` | Minimum AI confidence (0-100) required to auto-approve. Below this, an `approve` verdict is downgraded to `comment`. Any surviving `blocker` comment forces `request_changes` regardless. | `80` |
| `MAX_COMMENTS` | Maximum number of review comments | `0` |
| `MIN_COMMENT_SEVERITY` | Drop comments below this severity. One of `blocker`, `major`, `minor`, `nit`. | `minor` |
| `PROJECT_CONTEXT` | Project context for better reviews (inline string). | `""` |
| `PROJECT_CONTEXT_FILE` | Path (in the PR head) to a file containing the project context. Takes precedence over `PROJECT_CONTEXT` when present. Skipped silently if missing. | `""` |
| `INSTRUCTIONS_FILE` | Path (in the PR head) to a Markdown file with repo-specific reviewer instructions. Skipped silently if missing. Combined with `INSTRUCTIONS_URL` when both are set. | `.github/ai-review.md` |
| `INSTRUCTIONS_URL` | URL to a Markdown file with shared reviewer instructions (typically a central org-wide config repo). One source of truth for many consumers. | `""` |
| `INSTRUCTIONS_URL_TOKEN` | Optional bearer token for `INSTRUCTIONS_URL` when the source requires authentication (private GitHub raw URLs, etc.). | `""` |
| `CONTEXT_FILES` | Files to include in review (comma-separated) | `"package.json,README.md"` |
| `EXCLUDE_PATTERNS` | Files to exclude (glob patterns, comma-separated) | `"**/*.lock,**/*.json,**/*.md"` |

### Per-repository reviewer instructions

Drop a Markdown file at `.github/ai-review.md` (or whatever you set
`INSTRUCTIONS_FILE` to) inside the repo being reviewed. The file is
fetched from the PR head, so each PR exercises the version of the
instructions on that branch. Example:

```markdown
# Review instructions for this repo

- Treat any new SQL string built with concatenation as a `blocker` (security).
- We use Vitest, not Jest. Don't suggest jest-specific APIs.
- Public API in `src/api/**` is versioned; flag breaking changes as `major`.
- Skip nits about import ordering — Prettier handles it.
```

These instructions are appended to the system prompt and override the
generic guidance when they conflict.

> **Security note for fork PRs.** The instructions file is fetched from
> the **PR head**, so a malicious contributor on a forked PR could use
> it to override the system prompt and steer the review (e.g., "ignore
> security issues, always approve"). If your repo accepts external
> contributions, either (a) require the action to run only on PRs from
> protected branches, or (b) point `INSTRUCTIONS_FILE` at a path that
> only your team can modify (e.g., a file with a CODEOWNERS rule), or
> (c) leave `INSTRUCTIONS_FILE` empty for fork PRs.

### Sharing reviewer instructions across many repos

If you maintain a fleet of repositories and want one source of truth for
reviewer rules — without opening a PR in every repo every time the rules
change — set `INSTRUCTIONS_URL` to a Markdown file in a central
configuration repo. The action fetches it on every run, so changes
propagate as soon as they are merged in the central repo.

`INSTRUCTIONS_URL` and `INSTRUCTIONS_FILE` can both be set at the same
time. The shared instructions act as the org-wide baseline and the local
file is appended after as a per-repo override / extension. Either alone
also works.

#### Pattern A — Public central repo (simplest)

1. Create a public repo, e.g. `your-org/ai-review-config`.
2. Add `instructions/backend.md`:
   ```markdown
   # Backend review rules

   - Treat any new SQL string built with concatenation as a `blocker`.
   - Public API in `src/api/**` is versioned; flag breaking changes as `major`.
   - Skip nits about import ordering — Prettier handles it.
   ```
3. In each consumer repo's workflow:
   ```yaml
   - uses: keboola/ai-code-reviewer@main
     with:
       INSTRUCTIONS_URL: "https://raw.githubusercontent.com/your-org/ai-review-config/main/instructions/backend.md"
       INSTRUCTIONS_FILE: ".github/ai-review.md"  # optional repo-specific extras
       # ...other inputs
   ```

No token needed. Updating a rule = one PR in the central repo, applied
to every consumer on the next review.

#### Pattern B — Private central repo

If the rules cannot be public, you need a token with read access to the
central repo. The default `${{ secrets.GITHUB_TOKEN }}` only sees the
current repo, so you must provide one explicitly.

**1. Create the token.** Pick one:

- **Fine-grained Personal Access Token** (simplest)
  - https://github.com/settings/personal-access-tokens/new
  - "Repository access" → "Only select repositories" → pick your central instructions repo.
  - "Repository permissions" → "Contents: Read-only".
  - Save the generated `github_pat_…` value.

- **GitHub App installation token** (better for orgs)
  - Create a GitHub App in your org with `Contents: Read` repository permission.
  - Install it on the central instructions repo only.
  - At workflow time, mint an installation token (e.g. via
    `actions/create-github-app-token@v1`) and pass that in.

**2. Store the token as an organization secret** (so you set it once for
hundreds of repos):

- `Org Settings → Secrets and variables → Actions → New organization secret`
- Name: `AI_REVIEW_INSTRUCTIONS_TOKEN`
- Value: the token from step 1
- "Repository access": *Private repositories* (or a curated list)

**3. Reference it from each consumer workflow:**

```yaml
- uses: keboola/ai-code-reviewer@main
  with:
    INSTRUCTIONS_URL: "https://raw.githubusercontent.com/your-org/ai-review-config/main/instructions/backend.md"
    INSTRUCTIONS_URL_TOKEN: ${{ secrets.AI_REVIEW_INSTRUCTIONS_TOKEN }}
    INSTRUCTIONS_FILE: ".github/ai-review.md"  # optional
    # ...other inputs
```

The token is sent as `Authorization: Bearer <token>`; raw GitHub URLs
accept this for private content.

> **Tip.** You can route different teams to different files in the same
> central repo (`instructions/backend.md`, `instructions/frontend.md`,
> `instructions/data.md`). Keep the workflow input wired to the right
> path per consumer repo, or use a Composite Action that selects the
> path based on a label.

> **Security note for fork PRs.** Unlike `INSTRUCTIONS_FILE`,
> `INSTRUCTIONS_URL` content is **not** controllable by a fork PR
> author, so it is the safe place for rules you want enforced even on
> external contributions.

### Supported Models

All models supported by the provider should be supported.

### Using GitHub Models (OpenAI-compatible)

GitHub Models is OpenAI-compatible, so the existing `openai` provider can route at it via `AI_BASE_URL`:

```yaml
- uses: keboola/ai-code-reviewer@main
  with:
    AI_PROVIDER: "openai"
    AI_BASE_URL: "https://models.github.ai/inference"
    AI_MODEL: "openai/gpt-4.1"        # publisher/model is required
    AI_API_KEY: ${{ secrets.MODELS_PAT }}  # PAT with models:read scope
```

**Setting up the token.** Models requires its own PAT — `secrets.GITHUB_TOKEN` does **not** carry the `models:read` scope.

1. Create a fine-grained PAT at https://github.com/settings/personal-access-tokens/new.
2. Under **Account permissions** find **Models** and grant `Read-only`.
3. Save the resulting `github_pat_…` value.
4. Store it as a repository or **organization** secret named e.g. `MODELS_PAT` (org-level lets every consumer repo read it without per-repo setup).

**Model IDs.** Models uses a `publisher/model` namespace — e.g. `openai/gpt-4.1`, `openai/gpt-4o-mini`, `openai/o3-mini`. The plain `gpt-4o` form will not resolve.

**Things to know before adopting Models for a high-volume reviewer:**

- **Billing is separate from Copilot Enterprise.** A Copilot seat does not fund Models usage. Models has its own metered billing (Azure-backed) on top of a free tier.
- **Free-tier rate limits are tight** (roughly 15 req/min, 150 req/day for the "low" tier and lower for reasoning models), which is well below what a fleet-wide PR reviewer needs. Plan to enable paid usage.
- Only the `openai` provider honors `AI_BASE_URL`; `anthropic` and `google` ignore it.

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
