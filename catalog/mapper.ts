import type { Api, ModelSpec } from "./types";
import { isRecord, toInputCapabilities, toModelName, toNumber, toPositiveNumber } from "./utils";

export interface ModelsDevModel {
  id?: string;
  name?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  modalities?: {
    input?: string[];
  };
}

export function parseCatalogPayload(payload: unknown): ModelSpec<Api>[] {
  if (!isRecord(payload)) return [];
  const specs: ModelSpec<Api>[] = [];

  for (const [providerKey, rawProvider] of Object.entries(payload)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
    const providerId = (typeof rawProvider.id === "string" && rawProvider.id.trim()) || providerKey;
    const api: Api = providerId === "anthropic"
      ? "anthropic-messages"
      : providerId === "openrouter"
        ? "openrouter"
        : providerId === "google" || providerId === "google-vertex"
          ? "google-vertex"
          : "openai-completions";

    for (const [modelId, rawModel] of Object.entries(rawProvider.models)) {
      if (!isRecord(rawModel)) continue;
      const m = rawModel as ModelsDevModel;
      if (m.tool_call === false) continue;

      specs.push({
        id: modelId,
        name: toModelName(m.name, modelId),
        api,
        provider: providerId,
        reasoning: m.reasoning === true,
        input: toInputCapabilities(m.modalities?.input),
        cost: {
          input: toNumber(m.cost?.input) ?? 0,
          output: toNumber(m.cost?.output) ?? 0,
          cacheRead: toNumber(m.cost?.cache_read) ?? 0,
          cacheWrite: toNumber(m.cost?.cache_write) ?? 0,
        },
        contextWindow: toPositiveNumber(m.limit?.context, null),
        maxTokens: toPositiveNumber(m.limit?.output, null),
      });
    }
  }

  return specs;
}
