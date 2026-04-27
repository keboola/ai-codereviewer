import { ReviewRequest } from '../providers/AIProvider';

/**
 * Build the JSON payload sent as the user message to every provider.
 *
 * Includes:
 *   - files:        the modified files (path, content, diff) of this PR
 *   - contextFiles: extra files the consumer pinned via CONTEXT_FILES
 *                   (default: package.json, README.md). Useful for the
 *                   model to understand project shape without re-fetching.
 *   - pr:           title, description, base/head SHAs
 *   - context:      repository, owner, projectContext, isUpdate
 *                   (NOTE: repoInstructions is intentionally stripped
 *                   here — it's already in the system prompt where it
 *                   gets cached. Keeping it here too would double-count
 *                   tokens and bypass caching.)
 *   - previousReviews: prior bot comments, slimmed down to (path, line,
 *                   comment, summary). The full review object has more
 *                   fields the model doesn't need.
 */
export function buildUserPayload(request: ReviewRequest): string {
  const { repoInstructions: _omit, ...contextSansInstructions } = request.context;

  return JSON.stringify({
    type: 'code_review',
    files: request.files,
    contextFiles: request.contextFiles,
    pr: request.pullRequest,
    context: contextSansInstructions,
    previousReviews: request.previousReviews?.map(review => ({
      summary: review.summary,
      lineComments: review.lineComments.map(c => ({
        path: c.path,
        line: c.line,
        comment: c.comment,
      })),
    })),
  });
}
