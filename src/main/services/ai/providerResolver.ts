import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { ProviderConfig } from "../../../types/models";
import { getLogger } from '../logging';

const logger = getLogger();

/**
 * Resolve and configure the AI model provider for a given model ID
 * Handles all provider types: OpenRouter, Vercel Gateway, Local, and Cloud providers
 */
export async function getModelProvider(modelId: string): Promise<LanguageModelV2> {
  try {
    // Get providers configuration from preferences via IPC
    const { preferencesService } = await import("../preferencesService");

    let providers: ProviderConfig[];
    try {
      providers =
        (preferencesService.get("providers") as ProviderConfig[]) || [];

      // Debug: Log loaded providers
      logger.aiSdk.debug("Loaded providers from preferences", {
        providerCount: providers.length,
        providers: providers.map(p => ({
          id: p.id,
          type: p.type,
          hasApiKey: !!p.apiKey,
          apiKeyPrefix: p.apiKey?.substring(0, 10)
        }))
      });
    } catch (error) {
      logger.aiSdk.warn("No providers found in preferences, using empty array");
      providers = [];
    }

    // If no providers configured, throw error
    if (providers.length === 0) {
      logger.aiSdk.error("No providers configured");
      throw new Error(
        "No AI providers configured. Please configure at least one provider in the Models page."
      );
    }

    // Find which provider this model belongs to
    // For dynamic providers, check selectedModelIds (since models array is empty in storage)
    // For user-defined providers, check models array
    const providerWithModel = providers.find((provider) => {
      if (provider.modelSource === 'dynamic') {
        // Dynamic providers save only selectedModelIds
        return provider.selectedModelIds?.includes(modelId);
      } else {
        // User-defined providers have full model data
        return provider.models.some(
          (model) => model.id === modelId && model.isSelected !== false
        );
      }
    });

    if (!providerWithModel) {
      // Log all available providers and their models for debugging
      logger.aiSdk.error("Model not found in any configured provider", {
        modelId,
        totalProviders: providers.length,
        availableProviders: providers.map(p => ({
          id: p.id,
          name: p.name,
          type: p.type,
          modelSource: p.modelSource,
          modelCount: p.models.length,
          selectedModels: p.modelSource === 'dynamic'
            ? (p.selectedModelIds || [])
            : p.models.filter(m => m.isSelected !== false).map(m => m.id)
        }))
      });

      throw new Error(
        `Model "${modelId}" not found in any configured provider. Please select the model in the Models page and ensure it is enabled.`
      );
    }

    // Log the provider that will be used
    logger.aiSdk.info("Using configured provider for model", {
      modelId,
      providerType: providerWithModel.type,
      providerName: providerWithModel.name,
      providerId: providerWithModel.id,
      hasApiKey: !!providerWithModel.apiKey,
      hasBaseUrl: !!providerWithModel.baseUrl,
      apiKeyPrefix: providerWithModel.apiKey?.substring(0, 10) + '...'
    });

    // Configure provider based on type
    return configureProvider(providerWithModel, modelId);
  } catch (error) {
    logger.aiSdk.error("Error getting model provider configuration", {
      error: error instanceof Error ? error.message : error,
      modelId
    });
    // Re-throw the error instead of using fallback
    throw error;
  }
}

/**
 * Configure a specific provider based on its type
 */
function configureProvider(provider: ProviderConfig, modelId: string) {
  switch (provider.type) {
    case "vercel-gateway":
      return configureVercelGateway(provider, modelId);

    case "openrouter":
      return configureOpenRouter(provider, modelId);

    case "local":
      return configureLocalProvider(provider, modelId);

    case "openai":
      return configureOpenAI(provider, modelId);

    case "anthropic":
      return configureAnthropic(provider, modelId);

    case "google":
      return configureGoogle(provider, modelId);

    case "groq":
      return configureGroq(provider, modelId);

    case "xai":
      return configureXAI(provider, modelId);

    case "huggingface":
      return configureHuggingFace(provider, modelId);

    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }
}

/**
 * Configure Vercel AI Gateway provider
 */
function configureVercelGateway(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey || !provider.baseUrl) {
    throw new Error(
      `Vercel AI Gateway configuration incomplete for provider ${provider.name}`
    );
  }

  // For AI calls, use /v1/ai endpoint (different from models listing endpoint)
  const gatewayApiUrl = provider.baseUrl.includes("/v1/ai")
    ? provider.baseUrl
    : provider.baseUrl.replace("/v1", "/v1/ai");

  logger.aiSdk.debug("Creating Vercel Gateway provider", {
    modelId,
    gatewayApiUrl
  });

  const gateway = createGateway({
    apiKey: provider.apiKey,
    baseURL: gatewayApiUrl,
  });

  return gateway(modelId);
}

/**
 * Configure OpenRouter provider
 * Uses official @openrouter/ai-sdk-provider for full OpenRouter API compatibility
 */
function configureOpenRouter(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `OpenRouter API key is required. Get your free API key at https://openrouter.ai/keys`
    );
  }

  logger.aiSdk.debug("Creating OpenRouter provider", { modelId });

  const openrouter = createOpenRouter({
    apiKey: provider.apiKey,
  });

  return openrouter(modelId);
}

/**
 * Configure Local provider (Ollama, LM Studio, etc.)
 */
function configureLocalProvider(provider: ProviderConfig, modelId: string) {
  if (!provider.baseUrl) {
    throw new Error(
      `Local provider endpoint missing for provider ${provider.name}`
    );
  }

  // Ensure the baseURL has the /v1 suffix for OpenAI compatibility
  // Ollama, LM Studio, and other local providers use /v1/chat/completions
  let localBaseUrl = provider.baseUrl;
  if (!localBaseUrl.endsWith('/v1')) {
    localBaseUrl = localBaseUrl.replace(/\/$/, '') + '/v1';
  }

  logger.aiSdk.debug("Creating Local provider", {
    modelId,
    baseURL: localBaseUrl
  });

  const localProvider = createOpenAICompatible({
    name: "local",
    baseURL: localBaseUrl,
  });

  return localProvider(modelId);
}

/**
 * Configure OpenAI provider
 */
function configureOpenAI(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `OpenAI API key missing for provider ${provider.name}`
    );
  }

  logger.aiSdk.debug("Creating OpenAI provider", { modelId });

  const openaiProvider = createOpenAI({
    apiKey: provider.apiKey,
    // Only pass organization if explicitly set and not empty
    ...(provider.organizationId?.trim() && { organization: provider.organizationId.trim() }),
  });

  return openaiProvider(modelId);
}

/**
 * Configure Anthropic provider
 */
function configureAnthropic(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `Anthropic API key missing for provider ${provider.name}`
    );
  }

  logger.aiSdk.debug("Creating Anthropic provider", { modelId });

  const anthropicProvider = createAnthropic({
    apiKey: provider.apiKey,
  });

  return anthropicProvider(modelId);
}

/**
 * Configure Google AI provider
 */
function configureGoogle(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `Google AI API key missing for provider ${provider.name}`
    );
  }

  logger.aiSdk.debug("Creating Google provider", { modelId });

  const googleProvider = createGoogleGenerativeAI({
    apiKey: provider.apiKey,
  });

  return googleProvider(modelId);
}

/**
 * Configure Groq provider
 */
function configureGroq(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `Groq API key missing for provider ${provider.name}`
    );
  }

  logger.aiSdk.debug("Creating Groq provider", {
    modelId,
    baseURL: provider.baseUrl || "https://api.groq.com/openai/v1"
  });

  const groq = createOpenAICompatible({
    name: "groq",
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || "https://api.groq.com/openai/v1",
  });

  return groq(modelId);
}

/**
 * Configure xAI provider
 */
function configureXAI(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `xAI API key missing for provider ${provider.name}`
    );
  }

  logger.aiSdk.debug("Creating xAI provider", {
    modelId,
    baseURL: provider.baseUrl || "https://api.x.ai/v1"
  });

  const xai = createOpenAICompatible({
    name: "xai",
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || "https://api.x.ai/v1",
  });

  return xai(modelId);
}

/**
 * Configure Hugging Face provider
 */
function configureHuggingFace(provider: ProviderConfig, modelId: string) {
  if (!provider.apiKey) {
    throw new Error(
      `Hugging Face API key missing for provider ${provider.name}`
    );
  }

  // Find model in provider's models array to check taskType
  // Note: For dynamic providers (modelSource: 'dynamic'), the models array may be empty in storage
  // to save space. Only selectedModelIds is saved. In this case, we assume models from Router API
  // are chat models. For user-defined models, the full model data including taskType is available.
  const model = provider.models.find(m => m.id === modelId);
  const taskType = model?.taskType;

  // Determine if this is a dynamic provider (models fetched from API) or user-defined
  const isDynamicProvider = provider.modelSource === 'dynamic';

  logger.aiSdk.debug("Configuring Hugging Face model", {
    modelId,
    taskType: taskType || (isDynamicProvider ? 'chat (dynamic)' : 'unknown'),
    hasModel: !!model,
    isDynamicProvider,
    providerModelCount: provider.models.length
  });

  // For dynamic providers without explicit taskType, assume they're chat models
  // (Router API only returns chat-compatible models)
  if (!model && isDynamicProvider) {
    logger.aiSdk.debug("Dynamic provider model without taskType, assuming chat model", {
      modelId
    });
  }

  // Determine which API to use based on taskType
  // - chat, text-generation, image-text-to-text → Router API (OpenAI-compatible)
  // - Other inference tasks → Will be handled by InferenceDispatcher in aiService

  // For now, we always return Router API configuration
  // The aiService will detect inference models and route them to InferenceDispatcher
  const shouldUseRouterAPI = !taskType || taskType === 'chat' || taskType === 'image-text-to-text';

  if (shouldUseRouterAPI) {
    logger.aiSdk.debug("Creating Hugging Face provider with Router API", {
      modelId,
      taskType: taskType || 'chat (default)',
      baseURL: provider.baseUrl || "https://router.huggingface.co/v1"
    });
  } else {
    logger.aiSdk.info("Model will use Inference API (handled by aiService)", {
      modelId,
      taskType
    });
  }

  const huggingface = createOpenAICompatible({
    name: "huggingface",
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl || "https://router.huggingface.co/v1",
  });

  return huggingface(modelId);
}
