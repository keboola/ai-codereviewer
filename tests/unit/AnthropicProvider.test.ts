import { AnthropicProvider } from '../../src/providers/AnthropicProvider';

const messagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: messagesCreate },
    })),
  };
});

describe('AnthropicProvider', () => {
  beforeEach(() => {
    messagesCreate.mockReset();
    messagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({
        summary: 's', comments: [], suggestedAction: 'comment', confidence: 50,
      }) }],
    });
  });

  function makeRequest(): any {
    return {
      files: [{ path: 'a.ts', content: 'x', diff: '@@' }],
      pullRequest: { title: 't', description: 'd', base: 'b', head: 'h' },
      context: { repository: 'o/r', owner: 'o' },
    };
  }

  it('passes the system prompt as a cache-controlled content block', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
    await provider.review(makeRequest());

    const call = messagesCreate.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].type).toBe('text');
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].text).toContain('You are an expert code reviewer');
  });

  it('uses a single user message (no dual user roles)', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
    await provider.review(makeRequest());

    const call = messagesCreate.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[0].content).toContain('Return the response in JSON format');
  });

  it('warns when stop_reason is max_tokens', async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"summary":"s","comments":[],"suggestedAction":"comment","confidence":0}' }],
    });
    const warnSpy = jest.spyOn(require('@actions/core'), 'warning').mockImplementation(() => {});
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
    await provider.review(makeRequest());

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    warnSpy.mockRestore();
  });

  it('returns a graceful fallback when the first content block is not text', async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'tool_use' }],
    });
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
    const result = await provider.review(makeRequest());

    expect(result.suggestedAction).toBe('COMMENT');
    expect(result.lineComments).toEqual([]);
    expect(result.summary).toContain('non-text');
  });
});
