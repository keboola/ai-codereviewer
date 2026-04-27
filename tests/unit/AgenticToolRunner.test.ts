import { executeReadFile, makeAgenticEnv } from '../../src/services/AgenticToolRunner';
import { GitHubService } from '../../src/services/GitHubService';

function fakeGithub(map: Record<string, string>): GitHubService {
  return {
    getFileContent: jest.fn(async (p: string) => map[p] ?? ''),
  } as unknown as GitHubService;
}

describe('executeReadFile', () => {
  it('reads a regular file and tracks it in the dedup cache', async () => {
    const env = makeAgenticEnv({
      github: fakeGithub({ 'src/a.ts': 'hello' }),
      ref: 'h',
      excludePatterns: [],
    });
    const out = await executeReadFile(env, 'src/a.ts', 'inspect');
    expect(out).toBe('hello');
    expect(env.filesRead.get('src/a.ts')).toBe(5);
  });

  it('rejects parent-traversal paths', async () => {
    const env = makeAgenticEnv({ github: fakeGithub({}), ref: 'h', excludePatterns: [] });
    const out = await executeReadFile(env, '../etc/passwd', 'attack');
    expect(out).toMatch(/invalid path/);
  });

  it('rejects absolute paths', async () => {
    const env = makeAgenticEnv({ github: fakeGithub({}), ref: 'h', excludePatterns: [] });
    const out = await executeReadFile(env, '/etc/passwd', 'attack');
    expect(out).toMatch(/invalid path/);
  });

  it('rejects empty path', async () => {
    const env = makeAgenticEnv({ github: fakeGithub({}), ref: 'h', excludePatterns: [] });
    const out = await executeReadFile(env, '', 'oops');
    expect(out).toMatch(/non-empty/);
  });

  it('refuses to re-read the same file', async () => {
    const env = makeAgenticEnv({
      github: fakeGithub({ 'a.ts': 'x' }),
      ref: 'h',
      excludePatterns: [],
    });
    await executeReadFile(env, 'a.ts', 'r1');
    const out = await executeReadFile(env, 'a.ts', 'r2');
    expect(out).toMatch(/already read/);
  });

  it('honors EXCLUDE_PATTERNS', async () => {
    const env = makeAgenticEnv({
      github: fakeGithub({ 'node_modules/foo/index.js': 'x' }),
      ref: 'h',
      excludePatterns: ['node_modules/**'],
    });
    const out = await executeReadFile(env, 'node_modules/foo/index.js', 'why');
    expect(out).toMatch(/EXCLUDE_PATTERNS/);
  });

  it('returns "not found" when file is empty/missing', async () => {
    const env = makeAgenticEnv({ github: fakeGithub({}), ref: 'h', excludePatterns: [] });
    const out = await executeReadFile(env, 'missing.ts', 'why');
    expect(out).toMatch(/not found/);
  });

  it('truncates large files to maxBytesPerFile', async () => {
    const big = 'x'.repeat(500);
    const env = makeAgenticEnv({
      github: fakeGithub({ 'big.ts': big }),
      ref: 'h',
      excludePatterns: [],
      limits: { maxBytesPerFile: 100 },
    });
    const out = await executeReadFile(env, 'big.ts', 'why');
    expect(out).toMatch(/truncated to 100 of 500/);
    expect(env.filesRead.get('big.ts')).toBe(100);
  });

  it('refuses reads after the per-session budget is exhausted', async () => {
    const env = makeAgenticEnv({
      github: fakeGithub({ 'a.ts': 'x', 'b.ts': 'y', 'c.ts': 'z' }),
      ref: 'h',
      excludePatterns: [],
      limits: { maxFiles: 2 },
    });
    expect(await executeReadFile(env, 'a.ts', 'r')).toBe('x');
    expect(await executeReadFile(env, 'b.ts', 'r')).toBe('y');
    const out = await executeReadFile(env, 'c.ts', 'r');
    expect(out).toMatch(/budget exhausted/);
  });
});
