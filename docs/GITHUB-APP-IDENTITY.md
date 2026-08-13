# Giving the reviewer its own identity — GitHub App setup

By default the action signs its reviews with whatever token you hand it. Pass
`secrets.GITHUB_TOKEN` and every review and approval appears as
**`github-actions[bot]`** — the identity shared by *every* workflow in the
repository. You cannot tell an AI review apart from any other automation, and
`github-actions[bot]` cannot be renamed from a workflow.

Point the action at a GitHub App token instead and its reviews appear as
**`keboola-ai-code-reviewer[bot]`**, with its own name and avatar.

The action needs no code change — only a different token.

---

## Part 1 — One-time org setup (needs an org owner)

Do this once for the whole `keboola` org.

### 1. Create the App

`Org → Settings → Developer settings → GitHub Apps → New GitHub App`

| Field | Value |
|---|---|
| **GitHub App name** | `Keboola AI Code Reviewer` |
| Homepage URL | `https://github.com/keboola/ai-codereviewer` |
| Webhook | **uncheck "Active"** — this App is an identity, it hosts nothing |
| Where can this App be installed | Only on this account |

> **The name decides the bot login.** GitHub slugifies the App name, so
> `Keboola AI Code Reviewer` → `keboola-ai-code-reviewer[bot]`. App names are
> unique across all of GitHub; if the name is taken, GitHub will alter the slug
> and the login will differ. Verify it in step 5 before telling anyone the name.

### 2. Repository permissions

Only three. The action calls `pulls.get`, `pulls.listCommits`,
`pulls.listReviews`, `pulls.listReviewComments`, `pulls.createReview` and
`repos.getContent` — nothing else.

| Permission | Level | Why |
|---|---|---|
| Pull requests | **Read and write** | post review comments, submit the review/approval |
| Contents | **Read-only** | fetch `CONTEXT_FILES`, `INSTRUCTIONS_FILE`, and agentic `read_file` |
| Metadata | Read-only | mandatory, auto-selected |

Do **not** grant Issues or Administration. If your workflow also removes a
label after the review, leave that step on `secrets.GITHUB_TOKEN` rather than
widening the App.

### 3. Private key

On the App page: `Generate a private key`. A `.pem` downloads. It is shown
once — if you lose it, generate a new one and update the secret.

### 4. Org secrets

`Org → Settings → Secrets and variables → Actions → New organization secret`

| Secret | Value | Repository access |
|---|---|---|
| `AI_CODE_REVIEWER_APP_ID` | the numeric App ID from the App's General page | same list as `AI_CR_GOOGLE_API_KEY` |
| `AI_CODE_REVIEWER_PRIVATE_KEY` | the **entire** `.pem`, including the `-----BEGIN…` and `-----END…` lines and the trailing newline | same list as `AI_CR_GOOGLE_API_KEY` |

Match the visibility of the AI key secret — a repo that can review but cannot
mint the token is a broken half-migration.

> This step cannot be automated by installing the App. Writing an org secret
> needs a token with `secrets: write`, which does not exist before the App does.
> Pasting the key by hand once is the price of admission.

### 5. Install and verify the login

`Install App` → pick the repositories that run the reviewer (or All).

Then confirm the login is what everyone expects:

```bash
gh api /users/keboola-ai-code-reviewer%5Bbot%5D --jq '{login,type}'
# → {"login":"keboola-ai-code-reviewer[bot]","type":"Bot"}
```

A 404 means the slug differs from the name you assumed — read the actual slug
off the App's public page URL (`https://github.com/apps/<slug>`) and use that
everywhere.

---

## Part 2 — Per-repository workflow change

Add one step and change one line:

```yaml
      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          app-id: ${{ secrets.AI_CODE_REVIEWER_APP_ID }}
          private-key: ${{ secrets.AI_CODE_REVIEWER_PRIVATE_KEY }}

      - name: AI Code Review
        uses: keboola/ai-codereviewer@main
        with:
          GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
          # …everything else unchanged
```

`actions/create-github-app-token` is maintained by GitHub and scopes the token
to the current repository by default. Keep the private key there rather than
handing it to this action — the less code that touches signing material, the
better.

Leave any other step (label removal, comment cleanup) on
`secrets.GITHUB_TOKEN`. Only the review itself needs the new identity.

---

## What changes once you switch

- **Other workflows start firing on the review.** Events caused by
  `secrets.GITHUB_TOKEN` deliberately do not trigger further workflow runs.
  Events caused by an App token *do*. If anything in the repo listens on
  `pull_request_review`, check it will not loop.
- **Branch protection sees a new reviewer.** If a rule names required
  reviewers, `keboola-ai-code-reviewer[bot]` must be added; a rule that only
  demands *some* approval needs no change.
- **The App must be installed on the repo.** An org secret alone is not enough
  — `create-github-app-token` fails with `not installed` otherwise.
- **Token lifetime is one hour.** Fine for a review run; irrelevant otherwise.
- **No key rotation deadline.** Unlike a PAT, an App private key does not
  expire. Rotate it only on compromise or policy.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Input required and not supplied: app-id` | org secret not visible to this repo — check Repository access |
| `error:0909006C:PEM routines` | the secret holds a truncated key; paste the whole `.pem` including header, footer and trailing newline |
| `App is not installed on repository` | App created but not installed on that repo |
| Review still says `github-actions[bot]` | the action still receives `secrets.GITHUB_TOKEN` — check you changed the `GITHUB_TOKEN:` input, not just added the step |
| `Resource not accessible by integration` on approve | Pull requests permission is Read-only, not Read and write |

## Repositories using this action

As of the last sweep (`org:keboola path:.github/workflows keboola/ai-codereviewer`):

- `keboola/connection`
- `keboola/engineering-agentic-os-research`
- `keboola/keboola-agent-gauntlet`
- `keboola/kbc-master-bot`
- `keboola/runoola`
- `keboola/keboola-ai-adoption-dashboard`

Migrating them is independent and optional — a repo left on
`secrets.GITHUB_TOKEN` keeps working, it just keeps the anonymous identity.
