import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse, UsageReport } from './AIProvider';
import * as core from '@actions/core';
import { agenticTools, buildSystemPrompt, buildUserPayload, readFileTool, submitReviewTool } from '../prompts';
import { DEFAULT_AGENTIC_LIMITS } from '../services/AgenticToolRunner';
import { TextBlock } from '@anthropic-ai/sdk/resources';

export class AnthropicProvider implements AIProvider {
  private config!: AIProviderConfig;
  private client!: Anthropic;

  async initialize(config: AIProviderConfig): Promise<void> {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey
    });
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    core.debug(`Sending request to Anthropic with prompt structure: ${JSON.stringify(request, null, 2)}`);

    if (request.context.agenticReview && request.tools) {
      return this.reviewAgentic(request);
    }
    return this.reviewSingleShot(request);
  }

  private async reviewSingleShot(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = buildSystemPrompt(request);

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 8000,
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `${buildUserPayload(request)}\n\nReturn the response in JSON format only, no other text or comments.`,
        },
      ],
      temperature: this.config.temperature ?? 0.3,
    });

    if (response.stop_reason === 'max_tokens') {
      core.warning('Anthropic response was truncated (stop_reason=max_tokens).');
    }

    const firstBlock = response.content[0];
    if (!firstBlock || firstBlock.type !== 'text') {
      core.error(`Anthropic returned a non-text first content block (type=${firstBlock?.type ?? 'undefined'})`);
      return this.fallback('Anthropic returned a non-text response');
    }

    core.debug(`Raw Anthropic response: ${JSON.stringify(firstBlock.text, null, 2)}`);

    const parsed = this.parseSingleShot(response);
    parsed.usage = this.mergeUsage(undefined, this.extractUsage(response), 1);
    core.info(`Parsed response: ${JSON.stringify(parsed, null, 2)}`);
    return parsed;
  }

  private async reviewAgentic(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = buildSystemPrompt(request);
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildUserPayload(request) },
    ];

    let aggregateUsage: UsageReport | undefined;

    for (let turn = 1; turn <= DEFAULT_AGENTIC_LIMITS.maxTurns; turn++) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 8000,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        tools: [
          { name: readFileTool.name, description: readFileTool.description, input_schema: readFileTool.parameters as any },
          { name: submitReviewTool.name, description: submitReviewTool.description, input_schema: submitReviewTool.parameters as any },
        ],
        messages,
        temperature: this.config.temperature ?? 0.3,
      });

      aggregateUsage = this.mergeUsage(aggregateUsage, this.extractUsage(response), turn);

      if (response.stop_reason === 'max_tokens') {
        core.warning(`Anthropic turn ${turn} truncated (stop_reason=max_tokens).`);
      }

      const toolUses = response.content.filter((b: any) => b.type === 'tool_use');

      const submit = toolUses.find((b: any) => b.name === 'submit_review');
      if (submit) {
        const review = this.parseSubmitInput((submit as any).input);
        review.usage = aggregateUsage;
        core.info(`Agentic review submitted on turn ${turn}`);
        return review;
      }

      const reads = toolUses.filter((b: any) => b.name === 'read_file');
      if (reads.length === 0) {
        core.warning(`Anthropic turn ${turn} produced no tool call; ending loop`);
        break;
      }

      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        reads.map(async (b: any) => {
          const input = (b.input ?? {}) as { path?: string; reason?: string; start_line?: number; end_line?: number };
          const content = await request.tools!.readFile(
            input.path ?? '',
            input.reason ?? '',
            { startLine: input.start_line, endLine: input.end_line },
          );
          return {
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content,
          };
        })
      );
      messages.push({ role: 'user', content: toolResults });
    }

    core.warning(`Agentic loop hit max turns (${DEFAULT_AGENTIC_LIMITS.maxTurns}) without submit_review`);
    const fb = this.fallback('Agentic loop did not call submit_review within budget');
    fb.usage = aggregateUsage;
    return fb;
  }

  private parseSingleShot(response: Anthropic.Message): ReviewResponse {
    try {
      const content = JSON.parse((response.content[0] as TextBlock).text);
      return {
        summary: content.summary,
        lineComments: content.comments,
        suggestedAction: content.suggestedAction,
        confidence: content.confidence,
      };
    } catch (error) {
      core.error(`Failed to parse Anthropic response: ${error}`);
      return this.fallback('Failed to parse AI response');
    }
  }

  private parseSubmitInput(input: any): ReviewResponse {
    return {
      summary: input?.summary ?? '',
      lineComments: input?.comments ?? [],
      suggestedAction: input?.suggestedAction ?? 'COMMENT',
      confidence: input?.confidence ?? 0,
    };
  }

  private fallback(summary: string): ReviewResponse {
    return { summary, lineComments: [], suggestedAction: 'COMMENT', confidence: 0 };
  }

  private extractUsage(response: Anthropic.Message): UsageReport | undefined {
    const u = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    } | undefined;
    if (!u) return undefined;
    const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    return {
      inputTokens,
      outputTokens: u.output_tokens,
      cachedInputTokens: u.cache_read_input_tokens,
      totalTokens: inputTokens + (u.output_tokens ?? 0),
    };
  }

  private mergeUsage(prev: UsageReport | undefined, next: UsageReport | undefined, turns: number): UsageReport {
    const sum = (a?: number, b?: number) => (a ?? 0) + (b ?? 0);
    return {
      inputTokens: sum(prev?.inputTokens, next?.inputTokens),
      outputTokens: sum(prev?.outputTokens, next?.outputTokens),
      cachedInputTokens: sum(prev?.cachedInputTokens, next?.cachedInputTokens),
      totalTokens: sum(prev?.totalTokens, next?.totalTokens),
      turns,
    };
  }
}

// Tools array kept for symmetry with other providers; Anthropic uses individual entries above
void agenticTools;
