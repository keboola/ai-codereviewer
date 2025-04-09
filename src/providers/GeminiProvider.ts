import { GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderConfig, ReviewRequest, ReviewResponse } from './AIProvider';
import * as core from '@actions/core';
import { jsonrepair } from 'jsonrepair'
import { baseCodeReviewPrompt, updateReviewPrompt } from '../prompts';

export class GeminiProvider implements AIProvider {
  private config!: AIProviderConfig;
  private client!: GoogleGenerativeAI;
  private model!: GenerativeModel;

  async initialize(config: AIProviderConfig): Promise<void> {
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = this.client.getGenerativeModel({
      model: this.config.model,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
  }

  cleanJsonResponse(response: string): string {
    const possiblePrefixes: string[] = ["ny\n```json", "```json"];
    const suffix: string = "```";

    // Check the suffix once first.
    // If it doesn't end with the suffix, none of the prefix checks will
    // result in a successfully unwrapped block according to the rules.
    if (!response.endsWith(suffix)) {
        return response;
    }

    // Iterate through the known prefixes
    for (const prefix of possiblePrefixes) {
        if (response.startsWith(prefix)) {
            // Found a matching prefix AND we already know it ends with the suffix.
            const startIndex = prefix.length;
            // Slice from the end of the prefix to the start of the suffix.
            // Ensure the string is long enough to theoretically contain both,
            // although startsWith/endsWith should largely guarantee this.
            if (response.length >= startIndex + suffix.length) {
                const contentSlice = response.substring(startIndex, response.length - suffix.length);
                // Clean whitespace from the extracted part and return
                return contentSlice.trim();
            } else {
                // String ends with suffix and starts with prefix, but is too short. Malformed.
                return response; // Return original as it's not validly wrapped
            }
        }
    }

    // If the loop finishes, it means the string ended with the suffix,
    // but did not start with any of the known prefixes.
    return response;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    core.debug(`Sending request to Gemini with prompt structure: ${JSON.stringify(request, null, 2)}`);

    const result = await this.model.generateContent({
      systemInstruction: this.buildSystemPrompt(request),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: this.buildPullRequestPrompt(request),
            }
          ]
        }
      ]
    });

    const response = result.response;
    core.info(`Raw Gemini response: ${JSON.stringify(response.text(), null, 2)}`);

    const parsedResponse = this.parseResponse(response);
    core.info(`Parsed response: ${JSON.stringify(parsedResponse, null, 2)}`);

    return parsedResponse;
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

  private buildSystemPrompt(request: ReviewRequest): string {
    const isUpdate = request.context.isUpdate;
    return `
      ${baseCodeReviewPrompt}
      ${isUpdate ? updateReviewPrompt : ''}
    `;
  }

  private parseResponse(response: any): ReviewResponse {
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
      return {
        summary: 'Failed to parse AI response',
        lineComments: [],
        suggestedAction: 'COMMENT',
        confidence: 0,
      };
    }
  }
}
