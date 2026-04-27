import * as core from '@actions/core';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { ReviewService } from './services/ReviewService';
import { GitHubService } from './services/GitHubService';
import { DiffService } from './services/DiffService';
import { readFileSync } from 'fs';

async function main() {
  try {
    // Get inputs
    const provider = core.getInput('AI_PROVIDER');
    const model = core.getInput('AI_MODEL');
    const apiKey = core.getInput('AI_API_KEY');
    const baseURL = core.getInput('AI_BASE_URL');
    const githubToken = core.getInput('GITHUB_TOKEN');
    const temperature = parseFloat(core.getInput('AI_TEMPERATURE') || '0');

    // Get new configuration inputs
    const approveReviews = core.getBooleanInput('APPROVE_REVIEWS');
    const approveConfidenceThreshold = parseInt(core.getInput('APPROVE_CONFIDENCE_THRESHOLD') || '80', 10);
    const maxComments = parseInt(core.getInput('MAX_COMMENTS') || '0', 10);
    const minCommentSeverity = (core.getInput('MIN_COMMENT_SEVERITY') || 'minor').toLowerCase();

    validateInputs({ provider, minCommentSeverity });
    const projectContext = core.getInput('PROJECT_CONTEXT');
    const projectContextFile = core.getInput('PROJECT_CONTEXT_FILE');
    const instructionsFile = core.getInput('INSTRUCTIONS_FILE');
    const instructionsUrl = core.getInput('INSTRUCTIONS_URL');
    const instructionsUrlToken = core.getInput('INSTRUCTIONS_URL_TOKEN');
    const contextFilesInput = core.getInput('CONTEXT_FILES');
    const contextFiles = contextFilesInput ? contextFilesInput.split(',').map(f => f.trim()).filter(Boolean) : [];
    const excludePatterns = core.getInput('EXCLUDE_PATTERNS');

    // Initialize services
    const aiProvider = getProvider(provider);
    await aiProvider.initialize({
      apiKey,
      model,
      temperature,
      baseURL: baseURL || undefined,
    });

    // Initialize services
    const githubService = new GitHubService(githubToken);
    const diffService = new DiffService(githubToken, excludePatterns);
    const reviewService = new ReviewService(
      aiProvider,
      githubService,
      diffService,
      {
        maxComments,
        approveReviews,
        approveConfidenceThreshold,
        projectContext,
        projectContextFile,
        contextFiles,
        instructionsFile,
        instructionsUrl,
        instructionsUrlToken,
        providerLabel: provider,
        modelLabel: model,
        minCommentSeverity: minCommentSeverity as 'blocker' | 'major' | 'minor' | 'nit',
      }
    );

    // Get PR number from GitHub context
    const prNumber = getPRNumberFromContext();
    
    // Perform review
    const review = await reviewService.performReview(prNumber);
    
    core.info(`Review completed with ${review.lineComments?.length ?? 0} comments`);
    
  } catch (error: unknown) {
    core.setFailed(`Action failed: ${(error as Error).message}`);
  }
}

const VALID_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
const VALID_SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;

function validateInputs({ provider, minCommentSeverity }: { provider: string; minCommentSeverity: string }): void {
  if (!VALID_PROVIDERS.includes(provider.toLowerCase() as typeof VALID_PROVIDERS[number])) {
    throw new Error(`AI_PROVIDER must be one of [${VALID_PROVIDERS.join(', ')}]; got '${provider}'`);
  }
  if (!VALID_SEVERITIES.includes(minCommentSeverity as typeof VALID_SEVERITIES[number])) {
    throw new Error(`MIN_COMMENT_SEVERITY must be one of [${VALID_SEVERITIES.join(', ')}]; got '${minCommentSeverity}'`);
  }
}

function getProvider(provider: string) {
  switch (provider.toLowerCase()) {
    case 'openai':
      return new OpenAIProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'google':
      return new GeminiProvider();
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

function getPRNumberFromContext(): number {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error('GITHUB_EVENT_PATH is not set');
    }

    const { pull_request } = JSON.parse(
      readFileSync(eventPath, 'utf8')
    );

    if (!pull_request?.number) {
      throw new Error('Could not get pull request number from event payload');
    }

    return pull_request.number;
  } catch (error) {
    throw new Error(`Failed to get PR number: ${error}`);
  }
}

main().catch(error => {
  core.setFailed(`Unhandled error: ${error.message}`);
});
