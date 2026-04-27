import * as core from '@actions/core';
import { parse as parseYAML } from 'yaml';
import { GitHubService } from './GitHubService';
import { CommentSeverity } from '../providers/AIProvider';

/**
 * Per-repo overrides loaded from .github/ai-review.yml (or whatever
 * CONFIG_FILE is set to). Each field is optional; when present, it
 * overrides the matching action input. Sensitive / org-level inputs
 * (API keys, base URLs, instructions URL & token) are intentionally
 * NOT overridable from this file.
 */
export interface RepoConfig {
  min_comment_severity?: CommentSeverity;
  approve_reviews?: boolean;
  approve_confidence_threshold?: number;
  max_comments?: number;
  exclude_patterns?: string;
  instructions_file?: string;
  project_context?: string;
  project_context_file?: string;
}

const VALID_SEVERITIES = new Set<CommentSeverity>(['blocker', 'major', 'minor', 'nit']);

export async function loadRepoConfig(
  github: GitHubService,
  path: string | undefined,
  headRef: string
): Promise<RepoConfig> {
  if (!path?.trim()) return {};

  const content = await github.getFileContent(path, headRef, { quiet: true });
  if (!content || !content.trim()) return {};

  let parsed: unknown;
  try {
    parsed = parseYAML(content);
  } catch (e) {
    core.warning(`Failed to parse ${path} as YAML: ${e}; ignoring per-repo config`);
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    core.warning(`${path} did not parse as a YAML object; ignoring per-repo config`);
    return {};
  }

  const raw = parsed as Record<string, unknown>;
  const cfg: RepoConfig = {};

  if (typeof raw.min_comment_severity === 'string') {
    const v = raw.min_comment_severity.toLowerCase();
    if (VALID_SEVERITIES.has(v as CommentSeverity)) {
      cfg.min_comment_severity = v as CommentSeverity;
    } else {
      core.warning(`${path}: ignoring min_comment_severity='${raw.min_comment_severity}' (not one of blocker, major, minor, nit)`);
    }
  }
  if (typeof raw.approve_reviews === 'boolean') {
    cfg.approve_reviews = raw.approve_reviews;
  }
  if (typeof raw.approve_confidence_threshold === 'number' && Number.isFinite(raw.approve_confidence_threshold)) {
    cfg.approve_confidence_threshold = raw.approve_confidence_threshold;
  }
  if (typeof raw.max_comments === 'number' && Number.isFinite(raw.max_comments) && raw.max_comments >= 0) {
    cfg.max_comments = raw.max_comments;
  }
  if (typeof raw.exclude_patterns === 'string') {
    cfg.exclude_patterns = raw.exclude_patterns;
  }
  if (typeof raw.instructions_file === 'string') {
    cfg.instructions_file = raw.instructions_file;
  }
  if (typeof raw.project_context === 'string') {
    cfg.project_context = raw.project_context;
  }
  if (typeof raw.project_context_file === 'string') {
    cfg.project_context_file = raw.project_context_file;
  }

  const overrides = Object.keys(cfg);
  if (overrides.length > 0) {
    core.info(`Loaded per-repo config from ${path}; overriding: ${overrides.join(', ')}`);
  } else {
    core.info(`Loaded ${path} but it had no recognized keys`);
  }

  return cfg;
}
