import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse } from './AIProvider';
import * as core from '@actions/core';
import { buildSystemPrompt, reviewResponseSchema } from '../prompts';

export class OpenAIProvider implements AIProvider {
  private config!: AIProviderConfig;
  private client!: OpenAI;

  async initialize(config: AIProviderConfig): Promise<void> {
    this.config = config;
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: config.apiKey };
    if (config.baseURL) {
      clientOptions.baseURL = config.baseURL;
      core.info(`OpenAI client routed to baseURL: ${config.baseURL}`);
    }
    this.client = new OpenAI(clientOptions);
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    core.info(`Sending request to OpenAI with prompt structure: ${JSON.stringify(request, null, 2)}`);

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: this.getSystemPromptRole(),
          content: buildSystemPrompt(request),
        },
        {
          role: 'user',
          content: this.buildPullRequestPrompt(request),
        },
      ],
      temperature: this.getTemperature(),
      response_format: this.responseFormat(),
    });

    core.debug(`Raw OpenAI response: ${JSON.stringify(response.choices[0].message.content, null, 2)}`);

    const parsedResponse = this.parseResponse(response);
    parsedResponse.usage = this.extractUsage(response);
    core.info(`Parsed response: ${JSON.stringify(parsedResponse, null, 2)}`);

    return parsedResponse;
  }

  private extractUsage(response: OpenAI.Chat.Completions.ChatCompletion) {
    const u = response.usage;
    if (!u) return undefined;
    return {
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
      totalTokens: u.total_tokens,
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

  private parseResponse(response: OpenAI.Chat.Completions.ChatCompletion): ReviewResponse {
    const rawContent = response.choices[0].message.content ?? '{}';
    try {
      const content = JSON.parse(jsonrepair(this.extractJson(rawContent)));
      return {
        summary: content.summary,
        lineComments: content.comments,
        suggestedAction: content.suggestedAction,
        confidence: content.confidence,
      };
    } catch (error) {
      core.error(`Failed to parse OpenAI response: ${error}`);
      return {
        summary: 'Failed to parse AI response',
        lineComments: [],
        suggestedAction: 'COMMENT',
        confidence: 0,
      };
    }
  }

  private extractJson(raw: string): string {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return fenced[1].trim();
    }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return raw.slice(firstBrace, lastBrace + 1);
    }
    return raw;
  }

  private isO1Mini(): boolean {
    return this.config.model.includes('o1-mini');
  }

  private responseFormat(): OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'] {
    if (this.isO1Mini()) {
      return { type: 'text' };
    }
    return {
      type: 'json_schema',
      json_schema: {
        name: 'CodeReviewResponse',
        schema: reviewResponseSchema as Record<string, unknown>,
        strict: true,
      },
    };
  }

  private getSystemPromptRole(): 'system' | 'user' {
    // o1 doesn't support 'system' role
    return this.isO1Mini() ? 'user' : 'system';
  }

  private getTemperature(): number {
    // o1 only supports 1.0
    return this.isO1Mini() ? 1 : this.config.temperature ?? 0.3;
  }
}
