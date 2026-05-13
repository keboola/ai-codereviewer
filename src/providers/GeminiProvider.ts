import { Content, FunctionCallingMode, GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse, UsageReport } from './AIProvider';
import * as core from '@actions/core';
import { jsonrepair } from 'jsonrepair'
import { buildSystemPrompt, buildUserPayload, readFileTool, reviewResponseSchema, submitReviewTool } from '../prompts';
import { DEFAULT_AGENTIC_LIMITS } from '../services/AgenticToolRunner';
import { toGeminiSchema } from './geminiSchemaAdapter';

const geminiResponseSchema = toGeminiSchema(reviewResponseSchema);
const geminiSubmitParams = toGeminiSchema(submitReviewTool.parameters);
const geminiReadFileParams = toGeminiSchema(readFileTool.parameters);

export class GeminiProvider implements AIProvider {
  private config!: AIProviderConfig;
  private client!: GoogleGenerativeAI;
  private singleShotModel!: GenerativeModel;
  private agenticModel!: GenerativeModel;

  async initialize(config: AIProviderConfig): Promise<void> {
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.singleShotModel = this.client.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: geminiResponseSchema as any,
      },
    });
    this.agenticModel = this.client.getGenerativeModel({
      model: this.config.model,
      tools: [
        {
          functionDeclarations: [
            { name: readFileTool.name, description: readFileTool.description, parameters: geminiReadFileParams as any },
            { name: submitReviewTool.name, description: submitReviewTool.description, parameters: geminiSubmitParams as any },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.ANY },
      },
    });
  }

  cleanJsonResponse(response: string): string {
    const possiblePrefixes: string[] = ["ny\n```json", "```json"];
    const suffix: string = "```";

    if (!response.endsWith(suffix)) return response;
    for (const prefix of possiblePrefixes) {
      if (response.startsWith(prefix)) {
        const startIndex = prefix.length;
        if (response.length >= startIndex + suffix.length) {
          return response.substring(startIndex, response.length - suffix.length).trim();
        }
        return response;
      }
    }
    return response;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    core.debug(`Sending request to Gemini with prompt structure: ${JSON.stringify(request, null, 2)}`);

    if (request.context.agenticReview && request.tools) {
      return this.reviewAgentic(request);
    }
    return this.reviewSingleShot(request);
  }

  private async reviewSingleShot(request: ReviewRequest): Promise<ReviewResponse> {
    const result = await this.singleShotModel.generateContent({
      systemInstruction: buildSystemPrompt(request),
      contents: [{ role: 'user', parts: [{ text: buildUserPayload(request) }] }],
    });

    const response = result.response;
    core.info(`Raw Gemini response: ${JSON.stringify(response.text(), null, 2)}`);

    const parsed = this.parseSingleShot(response);
    parsed.usage = this.mergeUsage(undefined, this.extractUsage(response), 1);
    return parsed;
  }

  private async reviewAgentic(request: ReviewRequest): Promise<ReviewResponse> {
    const systemPrompt = buildSystemPrompt(request);
    const contents: Content[] = [
      { role: 'user', parts: [{ text: buildUserPayload(request) }] },
    ];

    let aggregateUsage: UsageReport | undefined;

    const maxTurns = request.context.agenticLimits?.maxTurns ?? DEFAULT_AGENTIC_LIMITS.maxTurns;
    for (let turn = 1; turn <= maxTurns; turn++) {
      const result = await this.agenticModel.generateContent({
        systemInstruction: systemPrompt,
        contents,
      });
      const response = result.response;
      aggregateUsage = this.mergeUsage(aggregateUsage, this.extractUsage(response), turn);

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const calls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

      const submit = calls.find((c: any) => c.name === 'submit_review');
      if (submit) {
        const review = this.parseSubmitArgs(submit.args);
        review.usage = aggregateUsage;
        core.info(`Agentic review submitted on turn ${turn}`);
        return review;
      }

      const reads = calls.filter((c: any) => c.name === 'read_file');
      if (reads.length === 0) {
        core.warning(`Gemini turn ${turn} produced no tool call; ending loop`);
        break;
      }

      contents.push({ role: 'model', parts: parts as any });
      const responses = await Promise.all(
        reads.map(async (c: any) => {
          const args = c.args ?? {};
          const content = await request.tools!.readFile(
            args.path ?? '',
            args.reason ?? '',
            { startLine: args.start_line, endLine: args.end_line },
          );
          return { name: 'read_file', response: { content } };
        })
      );
      contents.push({
        role: 'user',
        parts: responses.map(r => ({ functionResponse: r } as any)),
      });
    }

    core.warning(`Agentic loop hit max turns (${maxTurns}) without submit_review`);
    const fb = this.fallback('Agentic loop did not call submit_review within budget');
    fb.usage = aggregateUsage;
    return fb;
  }

  private extractUsage(response: any): UsageReport | undefined {
    const u = response.usageMetadata;
    if (!u) return undefined;
    return {
      inputTokens: u.promptTokenCount,
      outputTokens: u.candidatesTokenCount,
      cachedInputTokens: u.cachedContentTokenCount,
      totalTokens: u.totalTokenCount,
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

  private parseSingleShot(response: any): ReviewResponse {
    try {
      const content = JSON.parse(jsonrepair(this.cleanJsonResponse(response.text())));
      return {
        summary: content.summary,
        lineComments: content.comments,
        suggestedAction: content.suggestedAction,
        confidence: content.confidence,
      };
    } catch (error) {
      core.error(`Failed to parse Gemini response: ${error}`);
      return this.fallback('Failed to parse AI response');
    }
  }

  private parseSubmitArgs(args: any): ReviewResponse {
    return {
      summary: args?.summary ?? '',
      lineComments: args?.comments ?? [],
      suggestedAction: args?.suggestedAction ?? 'COMMENT',
      confidence: args?.confidence ?? 0,
    };
  }

  private fallback(summary: string): ReviewResponse {
    return { summary, lineComments: [], suggestedAction: 'COMMENT', confidence: 0 };
  }
}
