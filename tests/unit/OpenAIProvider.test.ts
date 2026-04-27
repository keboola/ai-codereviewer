import { OpenAIProvider } from '../../src/providers/OpenAIProvider';

const ctorSpy = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: any) => {
    ctorSpy(opts);
    return {
      chat: { completions: { create: jest.fn() } }
    };
  })
}));

describe('OpenAIProvider', () => {
  beforeEach(() => {
    ctorSpy.mockClear();
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
});
