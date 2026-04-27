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

  const repoInstructions = request.context.repoInstructions?.trim();
  if (repoInstructions) {
    sections.push(
      `------\nRepository-specific reviewer instructions (override the generic guidance above when they conflict):\n${repoInstructions}\n`
    );
  }

  return sections.join('\n');
}
