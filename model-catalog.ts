import { buildModel } from './catalog/build';
import { fetchCatalogJson } from './catalog/fetch';
import { buildModelReferenceIndex, inheritReferenceThinking, resolveModelReference } from './catalog/identity';
import { modelFamilyToken } from './catalog/identity/family';
import { parseCatalogPayload } from './catalog/mapper';
import type { Api, Model, ModelSpec, ThinkingConfig } from './catalog/types';

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
interface CatalogIndexes {
  all: ReferenceIndex;
  officialByFamily: Map<string, ReferenceIndex>;
}

const OFFICIAL_PROVIDERS_BY_FAMILY: Record<string, ReadonlySet<string>> = {
  anthropic: new Set(['anthropic']),
  openai: new Set(['openai']),
  gemini: new Set(['google', 'google-vertex']),
  gemma: new Set(['google', 'google-vertex']),
  grok: new Set(['xai']),
  deepseek: new Set(['deepseek']),
  kimi: new Set(['moonshot']),
  qwen: new Set(['qwen-portal', 'alibaba-coding-plan']),
  minimax: new Set(['minimax', 'minimax-code']),
  mimo: new Set(['xiaomi']),
  glm: new Set(['zai']),
  'gpt-oss': new Set(['openai']),
};

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const catalogUrlOverride = process.env.OMP_SWITCH_CATALOG_URL?.trim();
const catalogFetch = catalogUrlOverride
  ? ((_input: string | URL | Request, init?: RequestInit) => fetch(catalogUrlOverride, init))
  : undefined;
let cachedIndexes: { value: CatalogIndexes; expiresAt: number } | undefined;
let indexesPromise: Promise<CatalogIndexes> | undefined;

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

async function loadCatalogIndexes(): Promise<CatalogIndexes> {
  const now = Date.now();
  if (cachedIndexes && cachedIndexes.expiresAt > now) return cachedIndexes.value;
  if (indexesPromise) return indexesPromise;

  indexesPromise = (async () => {
    const payload = await fetchCatalogJson(catalogFetch);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('OMP 在线模型目录返回了无效数据');
    }
    const specs = parseCatalogPayload(payload);
    if (!specs.length) throw new Error('OMP 在线模型目录中没有可用模型');
    const models = specs.map(spec => buildModel(spec));
    const officialByFamily = new Map<string, ReferenceIndex>();
    for (const [family, providers] of Object.entries(OFFICIAL_PROVIDERS_BY_FAMILY)) {
      officialByFamily.set(family, buildModelReferenceIndex(models.filter(model => providers.has(model.provider))));
    }
    const indexes = { all: buildModelReferenceIndex(models), officialByFamily };
    cachedIndexes = { value: indexes, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
    return indexes;
  })().finally(() => {
    indexesPromise = undefined;
  });
  return indexesPromise;
}

function resolvePreferredReference(id: string, indexes: CatalogIndexes): Model<Api> | undefined {
  const fallback = resolveModelReference(id, indexes.all);
  const family = modelFamilyToken(id) || (fallback ? modelFamilyToken(fallback.id) : '');
  const officialIndex = family ? indexes.officialByFamily.get(family) : undefined;
  return (officialIndex && (resolveModelReference(id, officialIndex)
    ?? (fallback ? resolveModelReference(fallback.id, officialIndex) : undefined)))
    ?? fallback;
}

export function resolveCatalogModel(
  id: string,
  providerId: string,
  api: string,
  baseUrl: string,
  indexes: CatalogIndexes,
): ModelCatalogMatch {
  const normalizedId = id.trim();
  const reference = resolvePreferredReference(normalizedId, indexes);
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
  const indexes = await loadCatalogIndexes();
  return ids.map(id => resolveCatalogModel(id, request.providerId, request.api, request.baseUrl, indexes));
}
