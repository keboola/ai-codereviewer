import { OpenAIProvider } from '../../src/providers/OpenAIProvider';

const ctorSpy = jest.fn();
const completionsCreate = jest.fn().mockResolvedValue({
  choices: [{
    message: { content: JSON.stringify({
      summary: 's', comments: [], suggestedAction: 'comment', confidence: 50,
    }) },
  }],
});

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: any) => {
    ctorSpy(opts);
    return {
      chat: { completions: { create: completionsCreate } }
    };
  })
}));

describe('OpenAIProvider', () => {
  beforeEach(() => {
    ctorSpy.mockClear();
    completionsCreate.mockClear();
  });

  it('passes baseURL to the OpenAI client when provided', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({
      apiKey: 'k',
      model: 'openai/gpt-4.1',
      temperature: 0.3,
      baseURL: 'https://models.github.ai/inference',
    });

    expect(ctorSpy).toHaveBeenCalledWith({
      apiKey: 'k',
      baseURL: 'https://models.github.ai/inference',
    });
  });

  it('omits baseURL when not provided (default OpenAI endpoint)', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: 'k', model: 'gpt-4o-mini', temperature: 0 });

    const opts = ctorSpy.mock.calls[0][0];
    expect(opts.apiKey).toBe('k');
    expect(opts.baseURL).toBeUndefined();
  });

  function makeRequest(): any {
    return {
      files: [{ path: 'a.ts', content: 'x', diff: '@@' }],
      pullRequest: { title: 't', description: 'd', base: 'b', head: 'h' },
      context: { repository: 'o/r', owner: 'o' },
    };
  }

  it('uses json_schema response_format with strict mode for non-o1 models', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: 'k', model: 'gpt-4o-mini', temperature: 0 });
    await provider.review(makeRequest());

    const call = completionsCreate.mock.calls[0][0];
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(call.response_format.json_schema.name).toBe('CodeReviewResponse');
    expect(call.response_format.json_schema.schema.required).toContain('summary');
  });

  it('falls back to text response_format for o1-mini', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: 'k', model: 'o1-mini', temperature: 1 });
    await provider.review(makeRequest());

    const call = completionsCreate.mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'text' });
  });
});
