import type { Model } from "../../../../types/models";
import { getRendererLogger } from "@/services/logger";

const logger = getRendererLogger();

/**
 * Fetch models from Anthropic API
 */
export async function fetchAnthropicModels(params: {
  apiKey?: string;
  authMode?: 'api-key' | 'oauth';
}): Promise<Model[]> {
  try {
    const result = await window.levante.models.fetchAnthropic(params);

    if (!result.success) {
      throw new Error(result.error || "Failed to fetch Anthropic models");
    }

    const data = result.data || [];

    return data.map(
      (model: any): Model => ({
        id: model.id,
        name: model.display_name || model.id,
        provider: "anthropic",
        contextLength: 200000, // All Claude models have 200k context
        capabilities: ["text", "vision", "tools"],
        isAvailable: true,
        userDefined: false,
        pricing: undefined, // Anthropic API doesn't provide pricing
      })
    );
  } catch (error) {
    logger.models.error("Failed to fetch Anthropic models", {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}
