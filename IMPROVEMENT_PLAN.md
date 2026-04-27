# AI Code Reviewer — Improvement Plan

Goal: make the action (a) post higher-signal comments, (b) auto-approve only when a per-repo confidence bar is met, and (c) follow per-repository custom reviewer instructions.

Each bundle below ships as its own PR from a `vb/*` branch off `main`.

---

## Bundle 1 — `vb/review-quality-fixes` (mechanical fixes, no behavior config)

Reason to ship first: small, low-risk, removes silent bugs that suppress comments today.

- **D. Validate line numbers against the diff before submitting**
  - File: `src/services/GitHubService.ts` (`submitReview`)
  - Build a set of `(path, RIGHT-side line)` pairs from the parsed diff and drop only invalid comments instead of dropping all comments on retry.
- **E. Robust bot identification**
  - Files: `src/services/GitHubService.ts` (multiple methods using `github-actions[bot]`)
  - Resolve the authenticated user once via `octokit.users.getAuthenticated()` and filter previous reviews by that login.
- **F. Programmatic dedupe of repeated comments**
  - File: `src/services/ReviewService.ts` (before `submitReview`)
  - Hash `(path, line, normalized comment text)` of all previous bot comments and drop matches in the new review.
- **G. Smaller wins**
  - `src/main.ts:89` — replace `process.env.INPUT_AI_PROVIDER` / `INPUT_AI_MODEL` with the values already captured from `core.getInput`.
  - `src/providers/OpenAIProvider.ts` — apply same `jsonrepair` + fence-stripping path used in `GeminiProvider` so leading prose doesn't crash parsing.
  - `src/services/DiffService.ts` — pass real unified diff text per file to the AI providers (the custom `formatDiff` is unfamiliar shape for the models).

Tests: extend `tests/unit/DiffService.test.ts` and add a `GitHubService` unit test covering line-validation drop semantics.

---

## Bundle 2 — `vb/severity-tagged-comments`

Reason: makes the "what to comment on" policy explicit and tunable.

- **C. Severity tagging on comments**
  - `src/prompts/code-reviews.ts` — extend `outputFormat` so each comment requires `severity: "blocker" | "major" | "minor" | "nit"` and a `category`.
  - `src/providers/AIProvider.ts` — add the new fields to `ReviewResponse.lineComments`.
  - `src/services/ReviewService.ts` — apply `MIN_COMMENT_SEVERITY` filter before submission; force `REQUEST_CHANGES` if any `blocker` survives.
  - `action.yml` + `src/main.ts` — new input `MIN_COMMENT_SEVERITY` (default `minor`).
  - All three providers parse the new fields back out.
- Update `README.md` Configuration table.

---

## Bundle 3 — `vb/approve-threshold`

Reason: closes the loop on the existing-but-unused `confidence` field.

- **B. Confidence-threshold-gated approvals**
  - `action.yml` + `src/main.ts` — new input `APPROVE_CONFIDENCE_THRESHOLD` (default `80`).
  - `src/services/ReviewService.ts` (`normalizeReviewEvent`) — promote to `APPROVE` only if `action == 'approve' && confidence >= threshold && !hasBlocker`. If `request_changes` is suggested or any `blocker` survived, send `REQUEST_CHANGES`. Otherwise `COMMENT`.
- Update `README.md`.

Depends on Bundle 2 for the `hasBlocker` signal — merge order matters.

---

## Bundle 4 — `vb/per-repo-instructions`

Reason: highest leverage on review quality once the plumbing is solid.

- **A. Per-repo custom instructions file**
  - `action.yml` + `src/main.ts` — new input `INSTRUCTIONS_FILE` (default `.github/ai-review.md`).
  - `src/services/ReviewService.ts` — fetch the file from `prDetails.head` (already supported by `GitHubService.getFileContent`); skip silently if missing.
  - All three providers — inject the contents into `buildSystemPrompt` after the base prompt as a `# Repository-specific reviewer instructions` block.
- Update `README.md` with example `.github/ai-review.md` content.

(Optional follow-up, not in this plan: replace the file with a structured `.github/ai-review.yml` that supersedes action inputs. Defer until there's evidence repos want structured config.)

---

## Out of scope for this round

- Replacing `MAX_COMMENTS` truncation with severity-ordered selection (consider after Bundle 2).
- Multi-file PR-level summary deduplication across re-runs.
- Caching context-file fetches across runs.
