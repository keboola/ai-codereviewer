export interface AIProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  baseURL?: string;
}

export interface ReviewRequest {
  files: Array<{
    path: string;
    content: string;
    diff?: string;
  }>;
  contextFiles?: Array<{
    path: string;
    content: string;
  }>;
  previousReviews?: Array<{
    commit: string | null;
    summary: string;
    lineComments: Array<{
      path: string;
      line: number;
      comment: string;
      resolved?: boolean;
    }>;
  }>;
  pullRequest: {
    title: string;
    description: string;
    base: string;
    head: string;
  };
  context: {
    repository: string;
    owner: string;
    projectContext?: string;
    repoInstructions?: string;
    isUpdate?: boolean;
  };
}

export type CommentSeverity = 'blocker' | 'major' | 'minor' | 'nit';

export type CommentCategory =
  | 'security'
  | 'bug'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'docs'
  | 'test'
  | 'other';

export interface UsageReport {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

export interface ReviewResponse {
  summary: string;
  lineComments?: Array<{
    path: string;
    line: number;
    comment: string;
    severity?: CommentSeverity;
    category?: CommentCategory;
  }>;
  suggestedAction: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  confidence: number;
  usage?: UsageReport;
}

export interface AIProvider {
  initialize(config: AIProviderConfig): Promise<void>;
  review(request: ReviewRequest): Promise<ReviewResponse>;
}
