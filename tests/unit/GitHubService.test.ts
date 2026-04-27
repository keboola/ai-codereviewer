import { GitHubService } from '../../src/services/GitHubService';

const createReview = jest.fn().mockResolvedValue({ data: { id: 1 } });
const getAuthenticated = jest.fn().mockResolvedValue({
  data: { login: 'ai-reviewer-bot' }
});

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    pulls: { createReview },
    users: { getAuthenticated }
  }))
}));

describe('GitHubService.submitReview', () => {
  beforeEach(() => {
    createReview.mockClear();
    getAuthenticated.mockClear();
    process.env.GITHUB_REPOSITORY = 'octocat/hello';
  });

  it('drops only invalid line comments, keeps valid ones', async () => {
    const service = new GitHubService('mock-token');

    const validRightLines = new Map<string, Set<number>>([
      ['src/a.ts', new Set([2, 3])],
      ['src/b.ts', new Set([10])],
    ]);

    await service.submitReview(
      42,
      {
        summary: 'sum',
        suggestedAction: 'COMMENT',
        confidence: 50,
        lineComments: [
          { path: 'src/a.ts', line: 2, comment: 'good a:2' },
          { path: 'src/a.ts', line: 99, comment: 'bad a:99' },
          { path: 'src/b.ts', line: 10, comment: 'good b:10' },
          { path: 'src/c.ts', line: 1, comment: 'bad c:1 (file not in diff)' },
        ]
      },
      validRightLines
    );

    expect(createReview).toHaveBeenCalledTimes(1);
    const call = createReview.mock.calls[0][0];
    expect(call.event).toBe('COMMENT');
    expect(call.comments).toHaveLength(2);
    expect(call.comments.map((c: any) => `${c.path}:${c.line}`).sort())
      .toEqual(['src/a.ts:2', 'src/b.ts:10']);
  });

  it('passes all comments through when no validation map is provided', async () => {
    const service = new GitHubService('mock-token');

    await service.submitReview(7, {
      summary: 'sum',
      suggestedAction: 'COMMENT',
      confidence: 0,
      lineComments: [{ path: 'x.ts', line: 1, comment: 'whatever' }]
    });

    const call = createReview.mock.calls[0][0];
    expect(call.comments).toHaveLength(1);
  });

  it('caches authenticated user lookup', async () => {
    const service = new GitHubService('mock-token');
    const a = await service.getBotLogin();
    const b = await service.getBotLogin();
    expect(a).toBe('ai-reviewer-bot');
    expect(b).toBe('ai-reviewer-bot');
    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });
});
