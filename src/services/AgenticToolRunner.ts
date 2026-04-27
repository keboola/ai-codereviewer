import * as core from '@actions/core';
import { minimatch } from 'minimatch';
import { GitHubService } from './GitHubService';

export interface AgenticLimits {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTurns: number;
}

export const DEFAULT_AGENTIC_LIMITS: AgenticLimits = {
  maxFiles: 20,
  maxBytesPerFile: 200_000,
  maxTurns: 8,
};

export interface AgenticEnv {
  github: GitHubService;
  ref: string;
  excludePatterns: string[];
  limits: AgenticLimits;
  filesRead: Map<string, number>;
}

export function makeAgenticEnv(opts: {
  github: GitHubService;
  ref: string;
  excludePatterns: string[];
  limits?: Partial<AgenticLimits>;
}): AgenticEnv {
  return {
    github: opts.github,
    ref: opts.ref,
    excludePatterns: opts.excludePatterns,
    limits: { ...DEFAULT_AGENTIC_LIMITS, ...(opts.limits ?? {}) },
    filesRead: new Map(),
  };
}

/**
 * Execute the read_file tool. Returns either the file contents or a
 * short error message that the model can act on. Never throws.
 *
 * Path safety: rejects absolute paths, parent traversal (`..`),
 * empty paths, and anything matching EXCLUDE_PATTERNS. Caps total
 * file count and per-file size from `limits`.
 */
export async function executeReadFile(
  env: AgenticEnv,
  path: string,
  reason: string
): Promise<string> {
  if (!path || typeof path !== 'string') {
    return 'error: read_file requires a non-empty "path" argument';
  }

  const cleanPath = path.trim();
  if (cleanPath.startsWith('/') || cleanPath.includes('..')) {
    return `error: invalid path '${cleanPath}' — must be a repo-relative path without leading "/" or ".."`;
  }
  if (env.filesRead.has(cleanPath)) {
    const prevSize = env.filesRead.get(cleanPath)!;
    return `error: '${cleanPath}' was already read in this session (${prevSize} bytes); reuse the previous result instead of re-reading`;
  }
  if (env.excludePatterns.some(p => minimatch(cleanPath, p, { matchBase: true, dot: true }))) {
    return `error: '${cleanPath}' matches EXCLUDE_PATTERNS — not readable in this session`;
  }
  if (env.filesRead.size >= env.limits.maxFiles) {
    return `error: read budget exhausted — already read ${env.filesRead.size} files (limit ${env.limits.maxFiles}). Submit your review now.`;
  }

  const content = await env.github.getFileContent(cleanPath, env.ref, { quiet: true });
  if (!content) {
    env.filesRead.set(cleanPath, 0);
    return `error: '${cleanPath}' not found at PR head`;
  }

  const cap = env.limits.maxBytesPerFile;
  if (content.length > cap) {
    env.filesRead.set(cleanPath, cap);
    core.info(`[agentic] read_file ${cleanPath} (${content.length} bytes, truncated to ${cap}) — ${reason}`);
    return `[truncated to ${cap} of ${content.length} bytes]\n${content.slice(0, cap)}`;
  }

  env.filesRead.set(cleanPath, content.length);
  core.info(`[agentic] read_file ${cleanPath} (${content.length} bytes) — ${reason}`);
  return content;
}
