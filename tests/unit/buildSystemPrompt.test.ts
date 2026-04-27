import { buildSystemPrompt } from '../../src/prompts';
import { ReviewRequest } from '../../src/providers/AIProvider';

function makeRequest(overrides: Partial<ReviewRequest['context']> = {}): ReviewRequest {
  return {
    files: [],
    pullRequest: { title: 't', description: 'd', base: 'b', head: 'h' },
    context: {
      repository: 'o/r',
      owner: 'o',
      ...overrides,
    },
  };
}

describe('buildSystemPrompt', () => {
  it('returns just the base prompt when nothing else is set', () => {
    const prompt = buildSystemPrompt(makeRequest());
    expect(prompt).toContain('You are an expert code reviewer');
    expect(prompt).not.toContain('When reviewing updates');
    expect(prompt).not.toContain('Repository-specific reviewer instructions');
  });

  it('appends update guidance when isUpdate is true', () => {
    const prompt = buildSystemPrompt(makeRequest({ isUpdate: true }));
    expect(prompt).toContain('When reviewing updates');
  });

  it('appends repo-specific instructions block last so it can override', () => {
    const prompt = buildSystemPrompt(makeRequest({
      repoInstructions: 'Skip nits about import ordering.'
    }));
    const baseIdx = prompt.indexOf('You are an expert code reviewer');
    const repoIdx = prompt.indexOf('Repository-specific reviewer instructions');
    expect(baseIdx).toBeGreaterThan(-1);
    expect(repoIdx).toBeGreaterThan(baseIdx);
    expect(prompt).toContain('Skip nits about import ordering.');
  });

  it('skips the repo block when repoInstructions is just whitespace', () => {
    const prompt = buildSystemPrompt(makeRequest({ repoInstructions: '   \n\n  ' }));
    expect(prompt).not.toContain('Repository-specific reviewer instructions');
  });
});
