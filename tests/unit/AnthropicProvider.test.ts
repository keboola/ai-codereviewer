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

  describe('agentic loop', () => {
    it('drives a read_file → tool_result → submit_review loop and returns the parsed review', async () => {
      const readFile = jest.fn(async (path: string, _reason: string) =>
        path === 'src/utils/foo.ts' ? 'export const foo = () => 42;' : 'error: not found'
      );

      // Turn 1: model asks for src/utils/foo.ts
      messagesCreate.mockResolvedValueOnce({
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 },
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'src/utils/foo.ts', reason: 'need it' } },
        ],
      });
      // Turn 2: model submits the review
      messagesCreate.mockResolvedValueOnce({
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 40 },
        content: [
          {
            type: 'tool_use',
            id: 'tool_2',
            name: 'submit_review',
            input: {
              summary: 'looks good',
              comments: [{ path: 'a.ts', line: 1, comment: 'ok', severity: 'minor', category: 'style' }],
              suggestedAction: 'comment',
              confidence: 80,
            },
          },
        ],
      });

      const request = {
        ...makeRequest(),
        context: { repository: 'o/r', owner: 'o', agenticReview: true },
        tools: { readFile },
      };

      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
      const result = await provider.review(request);

      expect(messagesCreate).toHaveBeenCalledTimes(2);
      expect(readFile).toHaveBeenCalledWith('src/utils/foo.ts', 'need it', { startLine: undefined, endLine: undefined });
      expect(result.summary).toBe('looks good');
      expect(result.suggestedAction).toBe('comment');
      expect(result.confidence).toBe(80);
      expect(result.usage?.turns).toBe(2);
      expect(result.usage?.outputTokens).toBe(60); // 20 + 40
    });

    it('falls back gracefully when the loop exceeds max turns', async () => {
      // Every turn just asks for another file; never submits
      messagesCreate.mockResolvedValue({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'x', name: 'read_file', input: { path: 'a.ts', reason: 'r' } },
        ],
      });
      const readFile = jest.fn(async () => 'ok');

      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
      const result = await provider.review({
        ...makeRequest(),
        context: { repository: 'o/r', owner: 'o', agenticReview: true },
        tools: { readFile },
      });

      expect(result.suggestedAction).toBe('COMMENT');
      expect(result.summary).toMatch(/did not call submit_review/);
    });

    it('honors a per-request agenticLimits.maxTurns override', async () => {
      // Always asks for another file → loop only exits when the cap is reached.
      messagesCreate.mockResolvedValue({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'x', name: 'read_file', input: { path: 'a.ts', reason: 'r' } },
        ],
      });
      const readFile = jest.fn(async () => 'ok');

      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: 'k', model: 'claude-sonnet-4-6', temperature: 0.3 });
      await provider.review({
        ...makeRequest(),
        context: {
          repository: 'o/r',
          owner: 'o',
          agenticReview: true,
          agenticLimits: { maxFiles: 99, maxBytesPerFile: 99999, maxTurns: 3 },
        },
        tools: { readFile },
      });

      expect(messagesCreate).toHaveBeenCalledTimes(3);
    });
  });
});
