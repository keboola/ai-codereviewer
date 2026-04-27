import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse } from './AIProvider';
import * as core from '@actions/core';
import { buildSystemPrompt } from '../prompts';
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

    const systemPrompt = buildSystemPrompt(request);

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 8000,
      // Pass system as a content-block array so we can attach cache_control.
      // The base reviewer instructions are identical across every PR review,
      // so caching the system block trades one full-input billing for ~10%
      // on every subsequent call within the cache window.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `${this.buildPullRequestPrompt(request)}\n\nReturn the response in JSON format only, no other text or comments.`,
        },
      ],
      temperature: this.config.temperature ?? 0.3,
    });

    if (response.stop_reason === 'max_tokens') {
      core.warning(
        'Anthropic response was truncated (stop_reason=max_tokens). Some line comments may have been lost — consider raising max_tokens or trimming context.'
      );
    }

    const firstBlock = response.content[0];
    if (!firstBlock || firstBlock.type !== 'text') {
      core.error(`Anthropic returned a non-text first content block (type=${firstBlock?.type ?? 'undefined'})`);
      return {
        summary: 'Anthropic returned a non-text response',
        lineComments: [],
        suggestedAction: 'COMMENT',
        confidence: 0,
      };
    }

    core.debug(`Raw Anthropic response: ${JSON.stringify(firstBlock.text, null, 2)}`);

    const parsedResponse = this.parseResponse(response);
    parsedResponse.usage = this.extractUsage(response);
    core.info(`Parsed response: ${JSON.stringify(parsedResponse, null, 2)}`);

    return parsedResponse;
  }

  private extractUsage(response: Anthropic.Message) {
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

  private buildPullRequestPrompt(request: ReviewRequest): string {
    return JSON.stringify({
      type: 'code_review',
      files: request.files,
      pr: request.pullRequest,
      context: request.context,
      previousReviews: request.previousReviews?.map(review => ({
        summary: review.summary,
        lineComments: review.lineComments.map(comment => ({
          path: comment.path,
          line: comment.line,
          comment: comment.comment
        }))
      }))
    });
  }

  private parseResponse(response: Anthropic.Message): ReviewResponse {
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
      return {
        summary: 'Failed to parse AI response',
        lineComments: [],
        suggestedAction: 'COMMENT',
        confidence: 0,
      };
    }
  }
}
