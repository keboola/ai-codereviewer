import { loadRepoConfig } from '../../src/services/RepoConfigLoader';
import { GitHubService } from '../../src/services/GitHubService';

function fakeGithub(content: string): GitHubService {
  return {
    getFileContent: jest.fn().mockResolvedValue(content),
  } as unknown as GitHubService;
}

describe('loadRepoConfig', () => {
  it('returns empty when path is undefined', async () => {
    const cfg = await loadRepoConfig(fakeGithub(''), undefined, 'h');
    expect(cfg).toEqual({});
  });

  it('returns empty when file is missing (empty string content)', async () => {
    const cfg = await loadRepoConfig(fakeGithub(''), '.github/ai-review.yml', 'h');
    expect(cfg).toEqual({});
  });

  it('parses recognized keys and ignores unknown ones', async () => {
    const yaml = `
min_comment_severity: major
approve_reviews: false
approve_confidence_threshold: 90
max_comments: 5
exclude_patterns: "vendor/**,*.gen.ts"
instructions_file: ".github/rules.md"
project_context: "Backend service"
project_context_file: "ARCH.md"
unknown_key: "ignored"
`.trim();
    const cfg = await loadRepoConfig(fakeGithub(yaml), '.github/ai-review.yml', 'h');
    expect(cfg).toEqual({
      min_comment_severity: 'major',
      approve_reviews: false,
      approve_confidence_threshold: 90,
      max_comments: 5,
      exclude_patterns: 'vendor/**,*.gen.ts',
      instructions_file: '.github/rules.md',
      project_context: 'Backend service',
      project_context_file: 'ARCH.md',
    });
  });

  it('ignores invalid severity values with a warning, returns no override', async () => {
    const cfg = await loadRepoConfig(
      fakeGithub('min_comment_severity: criticla'),
      '.github/ai-review.yml',
      'h'
    );
    expect(cfg.min_comment_severity).toBeUndefined();
  });

  it('rejects malformed YAML gracefully', async () => {
    const cfg = await loadRepoConfig(
      fakeGithub('min_comment_severity: : :'),
      '.github/ai-review.yml',
      'h'
    );
    expect(cfg).toEqual({});
  });

  it('rejects YAML that is not an object (e.g. array, string)', async () => {
    const cfg = await loadRepoConfig(
      fakeGithub('- foo\n- bar'),
      '.github/ai-review.yml',
      'h'
    );
    expect(cfg).toEqual({});
  });

  it('rejects negative max_comments', async () => {
    const cfg = await loadRepoConfig(
      fakeGithub('max_comments: -3'),
      '.github/ai-review.yml',
      'h'
    );
    expect(cfg.max_comments).toBeUndefined();
  });
});
