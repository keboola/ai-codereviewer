import { AIProvider } from '../providers/AIProvider';
import { GitHubService } from '../services/GitHubService';
import { DiffService } from '../services/DiffService';
import { CommentSeverity, ReviewResponse } from '../providers/AIProvider';
import * as core from '@actions/core';

const SEVERITY_ORDER: CommentSeverity[] = ['nit', 'minor', 'major', 'blocker'];

function severityRank(s: CommentSeverity | undefined): number {
  if (!s) return SEVERITY_ORDER.indexOf('minor');
  const idx = SEVERITY_ORDER.indexOf(s);
  return idx === -1 ? SEVERITY_ORDER.indexOf('minor') : idx;
}

export interface ReviewServiceConfig {
  maxComments: number;
  approveReviews: boolean;
  approveConfidenceThreshold?: number;
  projectContext?: string;
  projectContextFile?: string;
  contextFiles?: string[];
  instructionsFile?: string;
  instructionsUrl?: string;
  instructionsUrlToken?: string;
  providerLabel?: string;
  modelLabel?: string;
  minCommentSeverity?: CommentSeverity;
}

export class ReviewService {
  private config: ReviewServiceConfig;

  constructor(
    private aiProvider: AIProvider,
    private githubService: GitHubService,
    private diffService: DiffService,
    config: ReviewServiceConfig
  ) {
    const rawThreshold = config.approveConfidenceThreshold;
    const threshold = (typeof rawThreshold === 'number' && Number.isFinite(rawThreshold))
      ? rawThreshold
      : 80;

    this.config = {
      maxComments: config.maxComments || 0,
      approveReviews: config.approveReviews,
      approveConfidenceThreshold: threshold,
      projectContext: config.projectContext,
      projectContextFile: config.projectContextFile,
      contextFiles: config.contextFiles || ['package.json', 'README.md'],
      instructionsFile: config.instructionsFile,
      instructionsUrl: config.instructionsUrl,
      instructionsUrlToken: config.instructionsUrlToken,
      providerLabel: config.providerLabel,
      modelLabel: config.modelLabel,
      minCommentSeverity: config.minCommentSeverity ?? 'minor',
    };
  }

  async performReview(prNumber: number): Promise<ReviewResponse> {
    core.info(`Starting review for PR #${prNumber}`);

    // Get PR details
    const prDetails = await this.githubService.getPRDetails(prNumber);
    core.info(`PR title: ${prDetails.title}`);

    // Get modified files from diff
    const lastReviewedCommit = await this.githubService.getLastReviewedCommit(prNumber);
    const isUpdate = !!lastReviewedCommit;

    // If this is an update, get previous reviews
    let previousReviews;
    if (isUpdate) {
      previousReviews = await this.githubService.getPreviousReviews(prNumber);
      core.debug(`Found ${previousReviews.length} previous reviews`);
    }

    const modifiedFiles = await this.diffService.getRelevantFiles(prDetails, lastReviewedCommit);
    core.info(`Modified files length: ${modifiedFiles.length}`);

    // Get full content for each modified file (head version only — the diff
    // already encodes what changed, so fetching the base version too would
    // double the file-content tokens for redundant context).
    const filesWithContent = await Promise.all(
      modifiedFiles.map(async (file) => {
        const content = await this.githubService.getFileContent(file.path, prDetails.head);
        return {
          path: file.path,
          content,
          diff: file.diff,
        };
      })
    );

    // Get repository context (now using configured files)
    const contextFiles = await this.getRepositoryContext();
    const repoInstructions = await this.getRepoInstructions(prDetails.head);

    // Perform AI review
    const review = await this.aiProvider.review({
      files: filesWithContent,
      contextFiles,
      previousReviews,
      pullRequest: {
        title: prDetails.title,
        description: prDetails.description,
        base: prDetails.base,
        head: prDetails.head,
      },
      context: {
        repository: process.env.GITHUB_REPOSITORY ?? '',
        owner: process.env.GITHUB_REPOSITORY_OWNER ?? '',
        projectContext: await this.getProjectContext(prDetails.head),
        repoInstructions,
        isUpdate,
      },
    });

    // Add model name to summary
    const provider = this.config.providerLabel?.toUpperCase()
      || process.env.INPUT_AI_PROVIDER?.toUpperCase()
      || 'AI';
    const model = this.config.modelLabel
      || process.env.INPUT_AI_MODEL
      || '';
    const modelInfo = `_Code review performed by \`${provider}${model ? ` - ${model}` : ''}\`._`;
    review.summary = `${review.summary}\n\n------\n\n${modelInfo}`;

    const validLinesByPath = new Map(
      modifiedFiles.map(f => [f.path, f.validRightLines])
    );

    const filteredBySeverity = this.filterBySeverity(review.lineComments ?? []);
    const dedupedComments = this.dedupeAgainstPrevious(filteredBySeverity, previousReviews);
    const validatedComments = this.dropInvalidLines(dedupedComments, validLinesByPath);
    const sortedComments = this.sortBySeverityDesc(validatedComments);
    const cappedComments = this.config.maxComments > 0
      ? sortedComments.slice(0, this.config.maxComments)
      : sortedComments;

    const hasBlocker = cappedComments.some(c => c.severity === 'blocker');

    await this.githubService.submitReview(
      prNumber,
      {
        ...review,
        lineComments: cappedComments,
        suggestedAction: this.normalizeReviewEvent(review.suggestedAction, {
          hasBlocker,
          confidence: review.confidence,
        }),
      },
      validLinesByPath
    );

    return review;
  }

  private dropInvalidLines(
    comments: NonNullable<ReviewResponse['lineComments']>,
    validLinesByPath: Map<string, Set<number>>
  ): NonNullable<ReviewResponse['lineComments']> {
    const kept: typeof comments = [];
    let dropped = 0;
    for (const c of comments) {
      const valid = validLinesByPath.get(c.path);
      if (valid && valid.has(c.line)) {
        kept.push(c);
      } else {
        dropped++;
        if (c.severity === 'blocker') {
          core.warning(
            `Blocker comment dropped because line is outside the diff: ${c.path}:${c.line}`
          );
        }
      }
    }
    if (dropped > 0) {
      core.info(`Dropped ${dropped} comment(s) targeting lines outside the PR diff`);
    }
    return kept;
  }

  private filterBySeverity(
    comments: NonNullable<ReviewResponse['lineComments']>
  ): NonNullable<ReviewResponse['lineComments']> {
    const min = severityRank(this.config.minCommentSeverity);
    const before = comments.length;
    const kept = comments.filter(c => severityRank(c.severity) >= min);
    const dropped = before - kept.length;
    if (dropped > 0) {
      core.info(
        `Dropped ${dropped} comment(s) below MIN_COMMENT_SEVERITY=${this.config.minCommentSeverity}`
      );
    }
    return kept;
  }

  private sortBySeverityDesc(
    comments: NonNullable<ReviewResponse['lineComments']>
  ): NonNullable<ReviewResponse['lineComments']> {
    return [...comments].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  private dedupeAgainstPrevious(
    newComments: NonNullable<ReviewResponse['lineComments']>,
    previousReviews?: Array<{ lineComments: Array<{ path: string; line: number; comment: string }> }>
  ): NonNullable<ReviewResponse['lineComments']> {
    if (!previousReviews || previousReviews.length === 0) {
      return newComments;
    }

    const seen = new Set<string>();
    for (const review of previousReviews) {
      for (const c of review.lineComments) {
        seen.add(this.commentKey(c.path, c.line, c.comment));
      }
    }

    const kept: typeof newComments = [];
    let droppedCount = 0;
    for (const c of newComments) {
      const key = this.commentKey(c.path, c.line, c.comment);
      if (seen.has(key)) {
        droppedCount++;
        continue;
      }
      seen.add(key);
      kept.push(c);
    }
    if (droppedCount > 0) {
      core.info(`Dropped ${droppedCount} duplicate comment(s) already posted in earlier reviews`);
    }
    return kept;
  }

  private commentKey(path: string, line: number, body: string): string {
    return `${path} ${line} ${body.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  }

  private async getRepoInstructions(headRef: string): Promise<string | undefined> {
    const shared = await this.fetchInstructionsUrl();
    const local = await this.fetchInstructionsFile(headRef);

    if (shared && local) {
      return `${shared.trim()}\n\n---\n\n${local.trim()}`;
    }
    return shared || local;
  }

  private async fetchInstructionsFile(headRef: string): Promise<string | undefined> {
    const path = this.config.instructionsFile?.trim();
    if (!path) return undefined;

    const content = await this.githubService.getFileContent(path, headRef, { quiet: true });
    if (content && content.trim().length > 0) {
      core.info(`Loaded repo-specific reviewer instructions from ${path}`);
      return content;
    }
    return undefined;
  }

  private async fetchInstructionsUrl(): Promise<string | undefined> {
    const url = this.config.instructionsUrl?.trim();
    if (!url) return undefined;

    try {
      const headers: Record<string, string> = {
        'Accept': 'text/plain, text/markdown, */*',
      };
      const token = this.config.instructionsUrlToken?.trim();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) {
        core.warning(
          `INSTRUCTIONS_URL fetch failed (${res.status} ${res.statusText}); skipping shared instructions`
        );
        return undefined;
      }
      const text = await res.text();
      if (text.trim().length > 0) {
        core.info(`Loaded shared reviewer instructions from ${url}`);
        return text;
      }
    } catch (error) {
      core.warning(`INSTRUCTIONS_URL fetch error: ${error}; skipping shared instructions`);
    }
    return undefined;
  }

  private async getProjectContext(headRef: string): Promise<string | undefined> {
    const path = this.config.projectContextFile?.trim();
    if (path) {
      const content = await this.githubService.getFileContent(path, headRef, { quiet: true });
      if (content && content.trim().length > 0) {
        core.info(`Loaded project context from ${path}`);
        return content;
      }
    }
    const inline = this.config.projectContext?.trim();
    return inline ? inline : undefined;
  }

  private async getRepositoryContext(): Promise<Array<{path: string, content: string}>> {
    const results = [];

    for (const file of (this.config.contextFiles || [])) {
      try {
        const content = await this.githubService.getFileContent(file);
        if (content) {
          results.push({ path: file, content });
        }
      } catch (error) {
        // File might not exist, skip it
      }
    }

    return results;
  }

  private normalizeReviewEvent(
    action: string,
    signals: { hasBlocker: boolean; confidence: number }
  ): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
    if (signals.hasBlocker) {
      return 'REQUEST_CHANGES';
    }

    if (!this.config.approveReviews) {
      return 'COMMENT';
    }

    const normalized = (action || '').toLowerCase();
    const threshold = this.config.approveConfidenceThreshold ?? 80;
    const confidence = (typeof signals.confidence === 'number' && Number.isFinite(signals.confidence))
      ? signals.confidence
      : 0;

    if (normalized === 'approve') {
      if (confidence >= threshold) {
        return 'APPROVE';
      }
      core.info(
        `Downgrading approve to comment: confidence ${confidence} < threshold ${threshold}`
      );
      return 'COMMENT';
    }

    if (normalized === 'request_changes') {
      return 'REQUEST_CHANGES';
    }

    return 'COMMENT';
  }
}
