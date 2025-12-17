import { getLogger } from "./logging";
import {
  validateLocalEndpoint,
  validatePublicUrl,
  logBlockedUrl,
  safeFetch,
  normalizeEndpoint,
} from "../utils/urlValidator";

interface ModelResponse {
  object: string;
  data: Array<Record<string, any>>;
  has_more?: boolean;
  next_offset?: string | null;
}

const logger = getLogger();

export class ModelFetchService {
  // Fetch OpenRouter models
  static async fetchOpenRouterModels(apiKey?: string): Promise<any[]> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add authorization header only if API key is provided
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers,
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch OpenRouter models", {
        error: error instanceof Error ? error.message : error,
        hasApiKey: !!apiKey,
      });
      throw error;
    }
  }

  // Fetch Vercel AI Gateway models
  static async fetchGatewayModels(
    apiKey: string,
    baseUrl: string = "https://ai-gateway.vercel.sh/v1"
  ): Promise<any[]> {
    let normalizedBaseUrl = baseUrl;
    try {
      // Normalize endpoint (add http:// if missing)
      normalizedBaseUrl = normalizeEndpoint(baseUrl);

      // Validate baseUrl format and protocol
      const validation = validateLocalEndpoint(normalizedBaseUrl);
      if (!validation.valid) {
        logBlockedUrl(
          normalizedBaseUrl,
          validation.error || "Invalid URL",
          "fetchGatewayModels"
        );
        throw new Error(validation.error || "Invalid gateway URL");
      }

      // For model listing, always use /v1 endpoint (not /v1/ai)
      const modelsEndpoint = normalizedBaseUrl.includes("/v1/ai")
        ? normalizedBaseUrl.replace("/v1/ai", "/v1")
        : normalizedBaseUrl;

      const response = await safeFetch(`${modelsEndpoint}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Gateway API error: ${response.statusText}`);
      }

      const data: ModelResponse = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch Gateway models", {
        error: error instanceof Error ? error.message : error,
        baseUrl: normalizedBaseUrl,
        modelsEndpoint: normalizedBaseUrl.includes("/v1/ai")
          ? normalizedBaseUrl.replace("/v1/ai", "/v1")
          : normalizedBaseUrl,
      });
      throw error;
    }
  }

  // Fetch local models (Ollama or OpenAI-compatible)
  static async fetchLocalModels(endpoint: string): Promise<any[]> {
    try {
      // Normalize endpoint (add http:// if missing)
      const normalizedEndpoint = normalizeEndpoint(endpoint);

      // Security: Validate endpoint URL to prevent SSRF attacks
      const validation = validateLocalEndpoint(normalizedEndpoint);
      if (!validation.valid) {
        logBlockedUrl(
          normalizedEndpoint,
          validation.error || "Invalid URL",
          "fetchLocalModels"
        );
        throw new Error(validation.error || "Invalid endpoint URL");
      }

      // 1. Try Ollama endpoint (/api/tags)
      try {
        const ollamaUrl = `${normalizedEndpoint}/api/tags`;
        logger.models.debug(`Trying Ollama endpoint: ${ollamaUrl}`);
        // Use shorter timeout for first attempt
        const response = await safeFetch(
          ollamaUrl,
          {
            headers: { "Content-Type": "application/json" },
          },
          2000
        );

        logger.models.debug(
          `Ollama endpoint response: ${response.status} ${response.statusText}`
        );

        if (response.ok) {
          const data = await response.json();
          logger.models.debug(
            `Ollama models found: ${data.models?.length || 0}`
          );

          // Only return if we actually found models, otherwise try OpenAI endpoint
          // LM Studio might return 200 OK for /api/tags but with empty/different structure
          if (data.models && data.models.length > 0) {
            return data.models;
          }
          logger.models.debug(
            `Ollama endpoint returned valid response but 0 models, falling back to OpenAI endpoint`
          );
        }
      } catch (e) {
        // Prepare to try next method
        logger.models.debug(
          `Ollama endpoint failed for ${normalizedEndpoint}, trying OpenAI-compatible endpoint`,
          { error: e }
        );
      }

      // 2. Try OpenAI-compatible endpoint (/v1/models)
      // This is used by LM Studio, LocalAI, etc.
      const url = `${normalizedEndpoint}/v1/models`;
      logger.models.debug(`Trying OpenAI endpoint: ${url}`);

      const response = await safeFetch(url, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      logger.models.debug(
        `OpenAI endpoint response: ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        throw new Error(`Local API error: ${response.statusText}`);
      }

      const data = await response.json();
      logger.models.debug(`Raw OpenAI data received:`, { data });

      const models = data.data || [];
      logger.models.debug(`OpenAI models found: ${models.length}`);

      // Normalize OpenAI models to match Ollama format (expecting 'name')
      const normalized = models.map((m: any) => ({
        ...m,
        name: m.name || m.id, // Ensure name exists
        details: m.details || { family: "unknown" },
      }));

      logger.models.debug(`Normalized models:`, { normalized });
      return normalized;
    } catch (error) {
      logger.models.error("Failed to fetch local models", {
        error: error instanceof Error ? error.message : error,
        endpoint: normalizeEndpoint(endpoint),
      });
      throw error;
    }
  }

  // Fetch OpenAI models
  static async fetchOpenAIModels(apiKey: string): Promise<any[]> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data: ModelResponse = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch OpenAI models", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Fetch Google AI models
  static async fetchGoogleModels(apiKey: string): Promise<any[]> {
    try {
      // Security: API key in Authorization header instead of URL query string
      // This prevents API key exposure in logs, browser history, and network monitoring
      const response = await safeFetch(
        "https://generativelanguage.googleapis.com/v1beta/models",
        {
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Google AI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.models || [];
    } catch (error) {
      logger.models.error("Failed to fetch Google models", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Fetch Anthropic models
  static async fetchAnthropicModels(apiKey: string): Promise<any[]> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch Anthropic models", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Fetch Groq models
  static async fetchGroqModels(apiKey: string): Promise<any[]> {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.statusText}`);
      }

      const data: ModelResponse = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch Groq models", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Fetch xAI models
  static async fetchXAIModels(apiKey: string): Promise<any[]> {
    try {
      const response = await fetch("https://api.x.ai/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`xAI API error: ${response.statusText}`);
      }

      const data: ModelResponse = await response.json();
      return data.data || [];
    } catch (error) {
      logger.models.error("Failed to fetch xAI models", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Fetch Hugging Face models
  static async fetchHuggingFaceModels(apiKey: string): Promise<any[]> {
    try {
      const allModels: any[] = [];
      let nextOffset: string | null | undefined = undefined;
      let page = 0;

      do {
        const url = new URL("https://router.huggingface.co/v1/models");
        if (nextOffset) {
          url.searchParams.set("after", nextOffset);
        }

        const response = await safeFetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Hugging Face API error: ${response.statusText}`);
        }

        const data: ModelResponse = await response.json();
        const models = data.data || [];
        allModels.push(...models);

        logger.models.debug("Fetched Hugging Face models page", {
          page,
          fetched: models.length,
          total: allModels.length,
          hasMore: data.has_more,
          nextOffset: data.next_offset,
        });

        if (data.has_more && data.next_offset) {
          nextOffset = data.next_offset;
          page += 1;
        } else {
          nextOffset = null;
        }
      } while (nextOffset);

      return allModels;
    } catch (error) {
      logger.models.error("Failed to fetch Hugging Face models", {
        error: error instanceof Error ? error.message : error,
        hasApiKey: !!apiKey,
      });
      throw error;
    }
  }
}
