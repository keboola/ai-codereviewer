import parseDiff, { File } from 'parse-diff';
import { minimatch } from 'minimatch';
import * as core from '@actions/core';
import { PRDetails } from './GitHubService';

export interface RelevantFile {
  path: string;
  diff: string;
  validRightLines: Set<number>;
}

export class DiffService {
  private excludePatterns: string[];
  private githubToken: string;

  constructor(githubToken: string, excludePatterns: string) {
    this.githubToken = githubToken;
    this.excludePatterns = this.parsePatterns(excludePatterns);
  }

  setExcludePatterns(excludePatterns: string): void {
    this.excludePatterns = this.parsePatterns(excludePatterns);
  }

  private parsePatterns(excludePatterns: string): string[] {
    return excludePatterns
      .split(',')
      .map(p => p.trim())
      .filter(p => p);
  }

  async getRelevantFiles(
    prDetails: PRDetails,
    lastReviewedCommit?: string | null
  ): Promise<RelevantFile[]> {
    const baseUrl = `https://api.github.com/repos/${prDetails.owner}/${prDetails.repo}`;
    const diffUrl = lastReviewedCommit ? 
      `${baseUrl}/compare/${lastReviewedCommit}...${prDetails.head}` :
      `${baseUrl}/pulls/${prDetails.number}`;

    const response = await fetch(diffUrl, {
      headers: {
        'Authorization': `Bearer ${this.githubToken}`,
        'Accept': 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      core.error(`Failed to fetch diff from ${diffUrl}: ${errorText}`);
      throw new Error(`Failed to fetch diff: ${response.statusText}`);
    }

    const diffText = await response.text();
    core.debug(`Full diff text length: ${diffText.length}`);

    const files = parseDiff(diffText);
    core.info(`Found ${files.length} files in diff`);

    return this.filterRelevantFiles(files);
  }

  private filterRelevantFiles(files: File[]): RelevantFile[] {
    core.debug(`Excluding patterns: ${this.excludePatterns.join(', ')}`);

    return files
      .filter(file => {
        const filePath = file.to ?? '';
        const shouldExclude = this.excludePatterns.some(pattern =>
          minimatch(filePath, pattern, { matchBase: true, dot: true })
        );

        core.debug(`File: ${filePath}, shouldExclude: ${shouldExclude}`);

        if (shouldExclude) {
          core.debug(`Excluding diff file based on pattern: ${filePath}`);
          return false;
        }

        return true;
      })
      .map(file => ({
        path: file.to ?? '',
        diff: this.formatDiff(file),
        validRightLines: this.collectRightLines(file),
      }));
  }

  private formatDiff(file: File): string {
    return file.chunks
      .map(chunk => {
        const lines = chunk.changes.map(c => {
          let lineNum: string;
          if (c.type === 'add') lineNum = String(c.ln);
          else if (c.type === 'normal') lineNum = String(c.ln2);
          else lineNum = '-';
          return `${lineNum.padStart(5)}| ${c.content}`;
        });
        return `@@ ${chunk.content} @@\n${lines.join('\n')}`;
      })
      .join('\n');
  }

  private collectRightLines(file: File): Set<number> {
    const lines = new Set<number>();
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === 'add' && typeof change.ln === 'number') {
          lines.add(change.ln);
        } else if (change.type === 'normal' && typeof change.ln2 === 'number') {
          lines.add(change.ln2);
        }
      }
    }
    return lines;
  }
}
