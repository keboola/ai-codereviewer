import { DiffService } from '../../src/services/DiffService';
import { PRDetails } from '../../src/services/GitHubService';
import * as core from '@actions/core';

// Mock fetch
global.fetch = jest.fn();

// Mock core.getInput
jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
  if (name === 'EXCLUDE_PATTERNS') return '**/*.md,**/*.json';
  return '';
});

describe('DiffService', () => {
  const mockPRDetails: PRDetails = {
    number: 123,
    owner: 'test-owner',
    repo: 'test-repo',
    base: 'main',
    head: 'feature',
    title: 'Test PR',
    description: 'Test PR description',
  };

  const mockDiffResponse = `diff --git a/src/test.ts b/src/test.ts
index abc..def 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 console.log("test");
+console.log("new line");
 console.log("end");`;

  beforeEach(() => {
    // Reset mocks
    (global.fetch as jest.Mock).mockReset();
    // Setup default mock response
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => mockDiffResponse
    });
  });

  it('should filter out excluded files', async () => {
    const service = new DiffService('mock-github-token', '**/*.md,**/*.json');
    const files = await service.getRelevantFiles(mockPRDetails);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(f => !f.path.endsWith('.md'))).toBeTruthy();
  });

  it('should format diff with right-side line numbers per line', async () => {
    const service = new DiffService('mock-github-token', '**/*.md,**/*.json');
    const files = await service.getRelevantFiles(mockPRDetails);
    expect(files[0].diff).toContain('@@ ');
    // Added line "new line" is at right-side line 2; format is "<num>| <originalDiffLine>".
    expect(files[0].diff).toMatch(/^\s+2\|\s\+console\.log\("new line"\);$/m);
    // First context line is at right-side line 1.
    expect(files[0].diff).toMatch(/^\s+1\|\s+console\.log\("test"\);$/m);
  });

  it('should expose RIGHT-side commentable line numbers including context', async () => {
    const service = new DiffService('mock-github-token', '**/*.md,**/*.json');
    const files = await service.getRelevantFiles(mockPRDetails);
    const lines = files[0].validRightLines;
    // @@ -1,3 +1,4 @@: context line 1 (right=1), added line 2 (right=2), context line 3 (right=3).
    expect(lines.has(1)).toBe(true); // context above
    expect(lines.has(2)).toBe(true); // added
    expect(lines.has(3)).toBe(true); // context below
    expect(lines.has(99)).toBe(false);
  });
});
