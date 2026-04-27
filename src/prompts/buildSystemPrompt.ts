import { ReviewRequest } from '../providers/AIProvider';
import { baseCodeReviewPrompt, updateReviewPrompt } from './code-reviews';

/**
 * Stitch together the system prompt sent to every provider:
 *   1. Base reviewer instructions (always)
 *   2. Update-flow guidance (only when the PR has prior bot reviews)
 *   3. Repository-specific instructions (when configured)
 *
 * Repo-specific instructions go last so they can override generic guidance
 * when the two conflict.
 */
export function buildSystemPrompt(request: ReviewRequest): string {
  const sections: string[] = [baseCodeReviewPrompt];

  if (request.context.isUpdate) {
    sections.push(updateReviewPrompt);
  }

  if (request.context.agenticReview) {
    sections.push(agenticAddendum);
  }

  const repoInstructions = request.context.repoInstructions?.trim();
  if (repoInstructions) {
    sections.push(
      `------\nRepository-specific reviewer instructions (override the generic guidance above when they conflict):\n${repoInstructions}\n`
    );
  }

  return sections.join('\n');
}

const agenticAddendum = `------
Agentic mode: you have two tools available.

- \`read_file(path, reason)\`: read any file from the PR head. Use it to inspect helpers, types, configuration, test fixtures, etc. that are referenced by the diff but not included in it. Spend reads only on files that meaningfully change your review — there is a per-session budget.
- \`submit_review(...)\`: terminator. Call this exactly once when you have all the context you need. The arguments are the review object. Do NOT emit free-form text in agentic mode — only tool calls are processed.

Do not request files just to add color; request files when the diff alone leaves a real ambiguity (e.g. "this calls foo() but foo isn't shown — is it async? does it throw?"). Reading the same file twice is wasteful and will be refused.`;
