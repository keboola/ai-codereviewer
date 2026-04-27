import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse, UsageReport } from './AIProvider';
import * as core from '@actions/core';
import { buildSystemPrompt, buildUserPayload, readFileTool, reviewResponseSchema, submitReviewTool } from '../prompts';
import { DEFAULT_AGENTIC_LIMITS } from '../services/AgenticToolRunner';

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

    if (request.context.agenticReview && request.tools) {
      return this.reviewAgentic(request);
    }
    return this.reviewSingleShot(request);
  }

  private async reviewSingleShot(request: ReviewRequest): Promise<ReviewResponse> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: this.getSystemPromptRole(), content: buildSystemPrompt(request) },
        { role: 'user', content: buildUserPayload(request) },
      ],
      temperature: this.getTemperature(),
      response_format: this.responseFormat(),
    });

    core.debug(`Raw OpenAI response: ${JSON.stringify(response.choices[0].message.content, null, 2)}`);

    const parsed = this.parseSingleShot(response);
    parsed.usage = this.mergeUsage(undefined, this.extractUsage(response), 1);
    return parsed;
  }

  private async reviewAgentic(request: ReviewRequest): Promise<ReviewResponse> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: this.getSystemPromptRole(), content: buildSystemPrompt(request) },
      { role: 'user', content: buildUserPayload(request) },
    ];

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      { type: 'function', function: { name: readFileTool.name, description: readFileTool.description, parameters: readFileTool.parameters as any } },
      { type: 'function', function: { name: submitReviewTool.name, description: submitReviewTool.description, parameters: submitReviewTool.parameters as any } },
    ];

    let aggregateUsage: UsageReport | undefined;

    for (let turn = 1; turn <= DEFAULT_AGENTIC_LIMITS.maxTurns; turn++) {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: this.getTemperature(),
      });

      aggregateUsage = this.mergeUsage(aggregateUsage, this.extractUsage(response), turn);

      const message = response.choices[0]?.message;
      if (!message) break;

      const toolCalls = message.tool_calls ?? [];

      const submit = toolCalls.find(tc => tc.type === 'function' && tc.function.name === 'submit_review');
      if (submit && submit.type === 'function') {
        const review = this.parseSubmitArguments(submit.function.arguments);
        review.usage = aggregateUsage;
        core.info(`Agentic review submitted on turn ${turn}`);
        return review;
      }

      const reads = toolCalls.filter(tc => tc.type === 'function' && tc.function.name === 'read_file');
      if (reads.length === 0) {
        core.warning(`OpenAI turn ${turn} produced no tool call; ending loop`);
        break;
      }

      messages.push(message);
      for (const read of reads) {
        if (read.type !== 'function') continue;
        let args: { path?: string; reason?: string } = {};
        try { args = JSON.parse(read.function.arguments); } catch { /* keep empty */ }
        const content = await request.tools!.readFile(args.path ?? '', args.reason ?? '');
        messages.push({ role: 'tool', tool_call_id: read.id, content });
      }
    }

    core.warning(`Agentic loop hit max turns without submit_review`);
    const fb = this.fallback('Agentic loop did not call submit_review within budget');
    fb.usage = aggregateUsage;
    return fb;
  }

  private extractUsage(response: OpenAI.Chat.Completions.ChatCompletion): UsageReport | undefined {
    const u = response.usage;
    if (!u) return undefined;
    return {
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
      totalTokens: u.total_tokens,
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

  private parseSingleShot(response: OpenAI.Chat.Completions.ChatCompletion): ReviewResponse {
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
      return this.fallback('Failed to parse AI response');
    }
  }

  private parseSubmitArguments(rawArgs: string): ReviewResponse {
    try {
      const args = JSON.parse(jsonrepair(rawArgs));
      return {
        summary: args.summary ?? '',
        lineComments: args.comments ?? [],
        suggestedAction: args.suggestedAction ?? 'COMMENT',
        confidence: args.confidence ?? 0,
      };
    } catch (error) {
      core.error(`Failed to parse submit_review arguments: ${error}`);
      return this.fallback('Failed to parse submit_review arguments');
    }
  }

  private fallback(summary: string): ReviewResponse {
    return { summary, lineComments: [], suggestedAction: 'COMMENT', confidence: 0 };
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
    return this.isO1Mini() ? 'user' : 'system';
  }

  private getTemperature(): number {
    return this.isO1Mini() ? 1 : this.config.temperature ?? 0.3;
  }
}
