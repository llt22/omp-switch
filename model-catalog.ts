import { buildModel } from '@oh-my-pi/pi-catalog/build';
import { buildModelReferenceIndex, inheritReferenceThinking, resolveModelReference } from '@oh-my-pi/pi-catalog/identity';
import {
  fetchWellKnownModels,
  mapModelsDevToModels,
  MODELS_DEV_PROVIDER_DESCRIPTORS,
} from '@oh-my-pi/pi-catalog/provider-models/openai-compat';
import type { Api, Model, ModelSpec, ThinkingConfig } from '@oh-my-pi/pi-catalog/types';

export interface ResolvedThinking {
  mode: string;
  efforts: string[];
  defaultLevel?: string;
  effortMap?: Record<string, string>;
  supportsDisplay?: boolean;
  suppressWhenOff?: boolean;
  requiresEffort?: boolean;
}

export interface ResolvedCompat {
  supportsReasoningEffort?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  thinkingFormat?: string;
  reasoningContentField?: string;
  reasoningEffortMap?: Record<string, string>;
  reasoningDisableMode?: string;
  requiresReasoningContentForToolCalls?: boolean;
  requiresThinkingAsText?: boolean;
}

export interface ResolvedModelConfig {
  id: string;
  reasoning?: boolean;
  thinking?: ResolvedThinking;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  compat?: ResolvedCompat;
}

export interface ModelCatalogMatch {
  id: string;
  matched: boolean;
  reference?: { provider: string; id: string };
  model?: ResolvedModelConfig;
}

export interface ResolveCatalogRequest {
  ids: string[];
  providerId: string;
  api: string;
  baseUrl: string;
}

type ReferenceIndex = ReturnType<typeof buildModelReferenceIndex>;

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const catalogUrlOverride = process.env.OMP_SWITCH_CATALOG_URL?.trim();
const catalogFetch = catalogUrlOverride
  ? ((_input: string | URL | Request, init?: RequestInit) => fetch(catalogUrlOverride, init))
  : undefined;
let cachedIndex: { value: ReferenceIndex; expiresAt: number } | undefined;
let indexPromise: Promise<ReferenceIndex> | undefined;

function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> | undefined {
  const entries = Object.entries(record).filter(([, value]) => {
    if (value === undefined) return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length > 0;
    return true;
  });
  return entries.length ? Object.fromEntries(entries) as Partial<T> : undefined;
}

function toThinking(
  thinking: ThinkingConfig | undefined,
  referenceThinking?: ThinkingConfig,
): ResolvedThinking | undefined {
  if (!thinking) return undefined;
  return compactRecord({
    mode: thinking.mode,
    efforts: [...(referenceThinking?.efforts ?? thinking.efforts)],
    defaultLevel: referenceThinking?.defaultLevel ?? thinking.defaultLevel,
    effortMap: thinking.effortMap ? { ...thinking.effortMap } : undefined,
    supportsDisplay: thinking.supportsDisplay,
    suppressWhenOff: thinking.suppressWhenOff,
    requiresEffort: referenceThinking?.requiresEffort ?? thinking.requiresEffort,
  }) as ResolvedThinking;
}

function toCompat(model: Model<Api>): ResolvedCompat | undefined {
  const compat = model.compat as Record<string, unknown> | undefined;
  if (!compat) return undefined;
  return compactRecord({
    supportsReasoningEffort: compat.supportsReasoningEffort as boolean | undefined,
    maxTokensField: compat.maxTokensField as ResolvedCompat['maxTokensField'],
    thinkingFormat: compat.thinkingFormat as string | undefined,
    reasoningContentField: compat.reasoningContentField as string | undefined,
    reasoningEffortMap: compat.reasoningEffortMap as Record<string, string> | undefined,
    reasoningDisableMode: compat.reasoningDisableMode as string | undefined,
    requiresReasoningContentForToolCalls: compat.requiresReasoningContentForToolCalls as boolean | undefined,
    requiresThinkingAsText: compat.requiresThinkingAsText as boolean | undefined,
  }) as ResolvedCompat | undefined;
}

async function loadReferenceIndex(): Promise<ReferenceIndex> {
  const now = Date.now();
  if (cachedIndex && cachedIndex.expiresAt > now) return cachedIndex.value;
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const payload = await fetchWellKnownModels(catalogFetch);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('OMP 在线模型目录返回了无效数据');
    }
    const specs = mapModelsDevToModels(payload as Record<string, unknown>, MODELS_DEV_PROVIDER_DESCRIPTORS);
    if (!specs.length) throw new Error('OMP 在线模型目录中没有可用模型');
    const index = buildModelReferenceIndex(specs.map(spec => buildModel(spec)));
    cachedIndex = { value: index, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
    return index;
  })().finally(() => {
    indexPromise = undefined;
  });
  return indexPromise;
}

export function resolveCatalogModel(
  id: string,
  providerId: string,
  api: string,
  baseUrl: string,
  index: ReferenceIndex,
): ModelCatalogMatch {
  const normalizedId = id.trim();
  const reference = resolveModelReference(normalizedId, index);
  if (!reference) return { id: normalizedId, matched: false };

  const resolved = buildModel({
    id: normalizedId,
    name: reference.name,
    provider: providerId || 'custom',
    api: api as Api,
    baseUrl,
    reasoning: reference.reasoning,
    thinking: inheritReferenceThinking(undefined, reference, providerId),
    input: [...reference.input],
    cost: reference.cost,
    contextWindow: reference.contextWindow,
    maxTokens: reference.maxTokens,
    compat: reference.compatConfig,
  } as ModelSpec<Api>);

  const compat = toCompat(resolved);
  return {
    id: normalizedId,
    matched: true,
    reference: { provider: reference.provider, id: reference.id },
    model: {
      id: normalizedId,
      reasoning: resolved.reasoning || undefined,
      thinking: toThinking(resolved.thinking, reference.thinking),
      input: [...resolved.input],
      contextWindow: resolved.contextWindow ?? undefined,
      maxTokens: resolved.maxTokens ?? undefined,
      compat,
    },
  };
}

export async function resolveCatalogModels(request: ResolveCatalogRequest): Promise<ModelCatalogMatch[]> {
  const ids = [...new Set(request.ids.map(id => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const index = await loadReferenceIndex();
  return ids.map(id => resolveCatalogModel(id, request.providerId, request.api, request.baseUrl, index));
}
