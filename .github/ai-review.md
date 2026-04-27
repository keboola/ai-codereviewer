# Review instructions for keboola/ai-codereviewer

This is the AI Code Reviewer GitHub Action itself. Reviews of this repo
should help maintainers, not generate noise. Apply these rules in
addition to the generic guidance.

## Verify before claiming

- **For any factual claim about an external API, SDK, model name, or
  protocol** (Anthropic, OpenAI, Google AI, Octokit, GitHub Models,
  GitHub Actions): include the exact doc URL or quote that supports the
  claim. If you cannot cite a source, do not raise the comment.
- Recent false positives we want to avoid:
  - "`input_tokens` already includes cached tokens" — *wrong*; per
    Anthropic docs the three usage fields are disjoint.
  - "`gpt-4o` works on GitHub Models" — *wrong*; Models requires the
    `publisher/model` form (`openai/gpt-4o`).

## Use read_file aggressively

This repo runs in agentic mode (`agentic_review: true`). When the diff
references a function, type, or test fixture that isn't in the diff,
**read it before commenting**. Comments rooted in "I assume X works
like…" are worse than no comment.

Strong reasons to call `read_file`:
- The diff calls a helper not shown — read it to know its contract.
- A test was added or changed — read the test to confirm it actually
  exercises the behavior the PR claims.
- A type or interface is referenced but not defined in the diff — read
  the source.

Weak reasons (skip):
- "Just to get more context." Be specific about what is actually missing.
- READMEs / docs files unless the PR changes them.

## Recognize intentional patterns

- `dist/` is committed on purpose — this repo ships as a node-action,
  the bundled JS is the entry point. Do not flag the dist diff as
  unrelated changes.
- `jsonrepair` + fenced-JSON extraction in `OpenAIProvider.parseResponse`
  is a fallback for non-strict-schema models (older o1, GitHub Models
  routes that don't honor `json_schema`). Do not propose removing it
  even though `response_format: json_schema` is the default path.
- `originalContent` was intentionally dropped — do not propose
  re-adding it; the diff already encodes what changed.
- The `core.warning` retry path in `GitHubService.submitReview` exists
  to handle GitHub returning 422 on a single bad line comment — do not
  propose fail-fast.

## Don't suggest

- "Add a comment explaining…" — code should be self-explanatory; if it
  isn't, propose a clearer name or smaller function.
- Renames driven purely by personal preference.
- Backwards-compatibility shims for inputs that have been in the action
  less than a release.
- Splitting into more files / barrels / index re-exports unless there
  is a concrete current consumer.

## Severity calibration for this repo

- `blocker`: real security issue (token leak, prompt-injection vector
  on fork PRs, command injection), data-loss risk, or a change that
  breaks an existing public action input or schema field.
- `major`: incorrect API call (wrong field name / shape against the
  cited SDK), missing await on a promise, unhandled rejection in a
  hot path.
- `minor`: type holes, weak narrowing, missing test for a new branch,
  unused export.
- `nit`: style only — these are dropped by default
  (`MIN_COMMENT_SEVERITY=minor`); don't bother emitting unless asked.

## Tests

- Tests live in `tests/unit/*.test.ts` and `tests/integration/*.test.ts`
  using Jest. Don't suggest a switch to Vitest.
- Real network calls are forbidden in tests. SDK clients are mocked via
  `jest.mock(...)`.
