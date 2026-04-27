import { reviewResponseSchema } from './reviewSchema';

/**
 * Tool: read_file
 *
 * Lets the model fetch any file from the PR head during the review.
 * Useful for inspecting referenced helpers, types, configuration,
 * test fixtures, etc. that are NOT in the diff but are needed to
 * judge the change correctly.
 *
 * The runner enforces:
 *   - paths must be repo-relative, no `..`, no leading `/`
 *   - the EXCLUDE_PATTERNS list also applies to reads
 *   - per-session caps on file count and bytes per file
 *   - already-read paths return a "you already read this" hint
 */
export const readFileTool = {
  name: 'read_file',
  description:
    'Read a file from the PR head. Use to inspect source files referenced by the diff (helpers, types, test fixtures, configs) that you need to review the change correctly. Do NOT use to fetch entire READMEs or large generated files. Each session has a budget; spend it on files that meaningfully change your review.',
  parameters: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['path', 'reason'],
    properties: {
      path: {
        type: 'string',
        description:
          'Repo-relative path, e.g. "src/utils/foo.ts". Must NOT start with "/" or contain "..".',
      },
      reason: {
        type: 'string',
        description:
          'One short sentence on why this file is necessary to review the change. Helps audit unnecessary reads.',
      },
    },
  },
} as const;

/**
 * Tool: submit_review
 *
 * Terminator. The model MUST call this exactly once to end the
 * session. The arguments ARE the review — same shape as the JSON
 * response in non-agentic mode (reviewResponseSchema).
 *
 * Calling submit_review is the only way to deliver the review;
 * plain text output during agentic mode is ignored.
 */
export const submitReviewTool = {
  name: 'submit_review',
  description:
    'Submit your final code review. Call this exactly once when you have all the context you need. The arguments are the review object. Calling this terminates the session.',
  parameters: reviewResponseSchema,
} as const;

export const agenticTools = [readFileTool, submitReviewTool] as const;
