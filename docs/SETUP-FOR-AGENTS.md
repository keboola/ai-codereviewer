# Setting up AI Code Reviewer in a repository — agent runbook

Audience: an autonomous coding agent (Claude Code, etc.) tasked with wiring
[`keboola/ai-codereviewer`](https://github.com/keboola/ai-codereviewer) into a
**Keboola** repository so every pull request gets an automated AI review.

This works for both **new** and **existing** repositories. API keys are provided
as **organization-level secrets** — you do *not* create or paste any keys.

---

## TL;DR (the happy path)

For a standard Keboola repo, do exactly this:

1. Commit `.github/workflows/code-review.yml` (template in Step 1).
2. Optionally commit `.github/ai-review.yml` (per-repo tuning, Step 2).
3. Commit `.github/ai-review.md` (repo-specific review rules, Step 3). This is
   **not** optional in practice: it must carry the model-identifier allowlist,
   without which the reviewer will flag your configured `AI_MODEL` as invalid.
4. Confirm the org secret `AI_CR_GOOGLE_API_KEY` is visible to the repo (Step 4).
5. Confirm `keboola/ai-codereviewer` is an allowed action (Step 5).
6. Open a throwaway PR to verify a review appears (Step 6).

That's it. Everything below is the detail behind those steps.

---

## Facts you must not get wrong

| Thing | Correct value | Common mistake |
|---|---|---|
| Action reference | `keboola/ai-codereviewer@main` | `keboola/ai-code-reviewer` (with hyphen) — **wrong**, that repo does not exist |
| Default provider for Keboola | `google` | defaulting to OpenAI |
| Default model | `gemini-3.1-pro-preview` | older gemini/gpt models |
| `.github/ai-review.md` | must include the **model-identifier allowlist** (Step 3) | omitting it → reviewer flags `gemini-3.1-pro-preview` as a "typo/invalid model" on the first PR |
| Org secret (Google) | `secrets.AI_CR_GOOGLE_API_KEY` | `GOOGLE_AI_KEY` (that's only in the generic README example) |
| Workflow `GITHUB_TOKEN` | `secrets.GITHUB_TOKEN` (auto-provided) | inventing a PAT |

> **Verify the secret name before you commit.** The known org secret is
> `AI_CR_GOOGLE_API_KEY`. If an Anthropic key exists it is conventionally
> `AI_CR_ANTHROPIC_API_KEY`. List what's actually available (needs org/repo
> admin):
> ```bash
> gh secret list --org keboola            # org-level secrets
> gh secret list --repo <owner>/<repo>    # repo-level (usually empty for this)
> ```
> If you can't list them, proceed with `AI_CR_GOOGLE_API_KEY` and flag the
> assumption to the user.

---

## Step 1 — Add the workflow

Create `.github/workflows/code-review.yml`. This is the canonical Keboola
workflow (provider = Google, org secret, auto mode + label re-trigger):

```yaml
name: AI Code Review

# Triggers:
#   - Auto: every non-draft PR (config via repo variables, see Step 4)
#   - On-demand: apply the "ai-review" label to any PR to (re-)review it
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
    #   - mode is "auto" (default) and the PR is not a draft (unless drafts allowed).
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
        uses: keboola/ai-codereviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

          # Provider + org-level key. Switch to anthropic + AI_CR_ANTHROPIC_API_KEY
          # only if that secret exists and the repo prefers Claude.
          AI_PROVIDER: "google"
          AI_API_KEY: ${{ secrets.AI_CR_GOOGLE_API_KEY }}
          AI_MODEL: "gemini-3.1-pro-preview"
          AI_TEMPERATURE: 0.3

          APPROVE_REVIEWS: true
          APPROVE_CONFIDENCE_THRESHOLD: 80
          MAX_COMMENTS: 10
          MIN_COMMENT_SEVERITY: minor

          # Don't waste tokens on lockfiles / build output. Tune per repo.
          EXCLUDE_PATTERNS: "**/*.lock,dist/**"

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

**Tailor before committing** — read the repo first, then adjust:
- `EXCLUDE_PATTERNS`: skip generated/vendored/lockfiles for this stack
  (e.g. `package-lock.json`, `poetry.lock`, `vendor/**`, `dist/**`, `**/*.snap`).
- `MAX_COMMENTS`: 5 for small repos, 10–15 for large ones. `0` = unlimited.
- `MIN_COMMENT_SEVERITY`: `minor` (default) is noisy-but-thorough; use `major`
  for high-traffic repos that only want signal.
- `APPROVE_REVIEWS: false` if the repo must **never** be auto-approved by a bot
  (e.g. a branch ruleset requires a human/code-owner approval anyway).

> **Anthropic instead of Google:** set `AI_PROVIDER: "anthropic"`,
> `AI_API_KEY: ${{ secrets.AI_CR_ANTHROPIC_API_KEY }}`, and an Anthropic model
> id (e.g. `claude-opus-4-8` / `claude-sonnet-4-6`). Only do this if that org
> secret exists.

---

## Step 2 — (Optional) per-repo overrides: `.github/ai-review.yml`

Use this when you want to tune knobs **without** editing the workflow — handy
when the workflow comes from an org template. Top-level keys here **override**
the matching workflow inputs. Every key is optional.

```yaml
# .github/ai-review.yml
min_comment_severity: major          # blocker | major | minor | nit
approve_reviews: true
approve_confidence_threshold: 90     # 0-100
max_comments: 5
exclude_patterns: "vendor/**,*.generated.ts,package-lock.json"

# Files always attached to the review so the model knows the project shape.
context_files:
  - package.json
  - tsconfig.json
  - README.md

# Repo-specific review rules (see Step 3).
instructions_file: ".github/ai-review.md"

# Large repo? Let the model read files beyond the diff on demand.
agentic_review: true                 # default false
agentic_max_files: 120               # default 80
agentic_max_bytes_per_file: 1048576  # default 1000000
agentic_max_turns: 50                # default 30
```

Notes:
- **Layering:** workflow inputs are the baseline; this file overrides per-repo;
  unspecified keys fall through to the workflow value.
- **Not overridable here** (stay in the workflow/secrets): API keys,
  `AI_BASE_URL`, `INSTRUCTIONS_URL`, `INSTRUCTIONS_URL_TOKEN`.
- **Agentic review** materially cuts wrong comments in large/multi-file repos at
  the cost of more tokens/turns. Enable it for anything non-trivial.
- Bad values are warned-and-ignored, never fail the run.

---

## Step 3 — repo-specific review rules: `.github/ai-review.md`

Free-form Markdown appended to the system prompt; it overrides generic guidance
on conflict. **Always commit this file** — even if you have no repo-specific
conventions yet, it must carry the **model-identifier allowlist** below.

### Required: the model-identifier allowlist

The reviewer runs on a model (`gemini-3.1-pro-preview` by default) whose *own*
training cutoff predates that model id. Without this block it will confidently —
and ironically — flag your configured `AI_MODEL` as a "typo", "invalid model",
or "not currently available" and tell you to downgrade to an older `gemini-1.5`
id, on the very first PR. Paste this verbatim into `.github/ai-review.md`:

```markdown
## Model identifiers — do NOT flag as nonexistent

Your training data has a knowledge cutoff. Models released after that
cutoff will look unfamiliar to you, but that does **not** mean they are
invalid. **Never** raise a comment claiming a model ID "does not exist",
"is not a valid model", "is not currently available", or suggesting a
"downgrade" to an older model — that judgement is out of scope for a code
review and you have no authoritative source for it (the API, not your
memory, is the source of truth).

The following identifiers are **known-valid current models** and must be
treated as correct wherever they appear (workflows, README, docs):

- Google: `gemini-3.1-pro-preview` (the model running *this* review),
  and any `gemini-3.x` / later id.
- Anthropic: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`,
  and any later Claude 4.x / Fable id.
- OpenAI: any current `gpt-4.x` / `o`-series id.

If you believe a model id is genuinely *malformed* (e.g. wrong provider
namespace like a missing `publisher/` prefix on GitHub Models), cite the
exact provider doc that defines the required format. Absent such a
citation, say nothing about the model id.
```

### Then add this repo's real conventions

Below the allowlist, write rules that encode this repo's actual conventions:

```markdown
# Review instructions for this repo

- We use Vitest, not Jest — don't suggest jest APIs.
- Treat SQL built by string concatenation as a `blocker` (security).
- Public API in `src/api/**` is versioned; flag breaking changes as `major`.
- Skip import-ordering nits — Prettier handles it.
```

> **Fork-PR security note.** This file is read from the **PR head**, so a
> malicious fork could rewrite it to steer the review ("always approve"). If the
> repo accepts external/fork contributions, prefer a central, author-proof
> source: set `INSTRUCTIONS_URL` in the workflow to a raw URL on `main` of a
> protected config repo (optionally with `INSTRUCTIONS_URL_TOKEN` for private
> sources), or leave instructions empty for fork PRs. For internal-only repos,
> `.github/ai-review.md` is fine.

---

## Step 4 — Trigger mode (repo variables) + org secret visibility

**Trigger mode** is controlled by Actions *repository variables*
(`Settings → Secrets and variables → Actions → Variables`), no code change:

| Variable | Values | Default | Effect |
|---|---|---|---|
| `AI_REVIEW_MODE` | `auto`, `label` | `auto` | `auto` = review every non-draft PR. `label` = only when `ai-review` label applied. |
| `AI_REVIEW_INCLUDE_DRAFTS` | `true`, `false` | `false` | `true` (auto mode) also reviews drafts. |

Set them only if you want non-default behavior:
```bash
gh variable set AI_REVIEW_MODE --body "auto"  --repo <owner>/<repo>
gh variable set AI_REVIEW_INCLUDE_DRAFTS --body "false" --repo <owner>/<repo>
```
Applying the `ai-review` label always forces a fresh review regardless of mode.

**Org secret visibility:** org secrets only reach a repo if the secret's
visibility includes it. For private repos this is often "selected repositories".
If the review run fails with an empty/missing `AI_API_KEY`, the repo isn't in
the secret's allow-list. Fix (needs org admin) in
`Org → Settings → Secrets and variables → Actions → AI_CR_GOOGLE_API_KEY → Repository access`,
or:
```bash
# Requires org admin. Public repos usually inherit org secrets automatically.
gh api -X PUT orgs/keboola/actions/secrets/AI_CR_GOOGLE_API_KEY/repositories/<repo_id>
```
If you lack admin, surface this to the user as a required manual step.

---

## Step 5 — Allow the action to run

Org Actions policy may restrict which third-party actions are usable.
`keboola/ai-codereviewer` is in-org, so it's allowed when the policy permits
actions from the `keboola` org (typical). If a run fails with a policy error,
ask an org admin to allow it under
`Org → Settings → Actions → General → Allowed actions`.

Also confirm `Settings → Actions → General → Workflow permissions` allows the
workflow to write — the workflow declares `permissions: write-all`, but an org
default of read-only can override it. The action needs write to post review
comments and approvals.

---

## Step 6 — Verify

1. Commit the files on a branch and open a PR (or open a tiny throwaway PR).
   ```bash
   git checkout -b chore/ai-code-review
   git add .github/
   git commit -m "Add AI Code Reviewer workflow"
   git push -u origin chore/ai-code-review
   gh pr create --fill
   ```
2. Watch the run:
   ```bash
   gh run list --workflow "AI Code Review" --repo <owner>/<repo>
   gh run watch --repo <owner>/<repo>
   ```
3. Confirm the bot posted review comments / an approval on the PR. If nothing
   appears, jump to Troubleshooting.
4. Test the manual path: add the `ai-review` label to a PR and confirm a fresh
   review runs and the label is auto-removed.

---

## New repo vs. existing repo

- **New repo:** create `.github/workflows/` and drop the workflow in, and still
  commit `.github/ai-review.md` with the model-identifier allowlist (Step 3) —
  otherwise the first PR gets a bogus "invalid model" comment. The first PR after
  the default branch exists will be reviewed.
- **Existing repo:** same workflow, but invest more in tailoring:
  - Set `EXCLUDE_PATTERNS` to this repo's generated/vendored paths.
  - Add `.github/ai-review.yml` with `context_files` (manifests, tsconfig, etc.)
    and `agentic_review: true` for large codebases.
  - Add `.github/ai-review.md` capturing existing conventions so the reviewer
    matches the team instead of generic best-practice noise.
  - Check existing branch protection / rulesets: if a ruleset requires a human
    or code-owner approval, a bot approval won't satisfy it — keep
    `APPROVE_REVIEWS` on for the comments, but don't expect it to unblock merges.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Run skipped entirely | `AI_REVIEW_MODE=label` and no label, or PR is a draft | Apply `ai-review` label, or set mode to `auto` / allow drafts (Step 4) |
| Error: action not found | Wrong ref `keboola/ai-code-reviewer` | Use `keboola/ai-codereviewer@main` |
| Auth/empty API key error | Org secret not visible to repo, or wrong name | Step 4 visibility; verify name with `gh secret list --org keboola` |
| "Resource not accessible by integration" | Read-only workflow permissions | Step 5 workflow permissions / keep `permissions: write-all` |
| Action blocked by policy | Org allowed-actions restriction | Step 5, ask org admin |
| Reviews too noisy | severity too low / max too high | Raise `MIN_COMMENT_SEVERITY` to `major`, lower `MAX_COMMENTS` |
| Bot flags `AI_MODEL` as invalid / "typo" / says to downgrade | `.github/ai-review.md` missing the model-identifier allowlist; reviewer's training cutoff predates the model id | Add the allowlist block from Step 3 and re-trigger (apply the `ai-review` label) |
| Wrong comments from missing context | diff-only review on a big repo | Enable `agentic_review: true` + add `context_files` (Step 2) |

---

## Full input reference

For every action input (defaults, semantics, agentic knobs, `INSTRUCTIONS_URL`,
`CONFIG_FILE`, etc.) see the **Configuration** table in the
[ai-codereviewer README](https://github.com/keboola/ai-codereviewer#configuration).
This runbook covers the Keboola-org defaults; the README is the source of truth
for the complete surface.
