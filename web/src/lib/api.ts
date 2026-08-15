// API 客户端与类型定义
export interface ThinkingCfg { mode?: string; minLevel?: string; maxLevel?: string }
export interface ModelCompat {
  supportsReasoningEffort?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  thinkingFormat?: string;
  reasoningContentField?: string;
  reasoningEffortMap?: Record<string, string>;
  requiresReasoningContentForToolCalls?: boolean;
  requiresThinkingAsText?: boolean;
}
export interface ModelCfg {
  id: string;
  name?: string;
  reasoning?: boolean;
  thinking?: ThinkingCfg;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  compat?: ModelCompat;
  limitsEstimated?: boolean;
  extra?: Record<string, unknown>;
}
export interface ProviderCfg {
  id: string;
  name: string;
  type: 'openai-compatible' | 'anthropic' | 'openai' | 'gemini';
  api: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyMasked?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models: ModelCfg[];
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
  extra?: Record<string, unknown>;
}
export interface BackupInfo {
  name: string;
  size: number;
  mtime: number;
  providerCount: number | null;
  trigger: 'apply' | 'restore' | 'legacy';
}
export interface State {
  providers: ProviderCfg[];
  apiOptions: Record<string, { label: string; defaultBaseUrl: string; keyHeader: string }>;
  current: { exists: boolean; providers: ProviderCfg[]; enabledCount: number; hasUnappliedChanges: boolean };
  backups: BackupInfo[];
}

export const TYPES = [
  { type: 'openai-compatible', icon: '⚙️', name: 'OpenAI 兼容', desc: '通用网关', api: 'openai-completions', baseUrl: '', auth: true },
  { type: 'anthropic', icon: '✳️', name: 'Claude', desc: 'Anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', auth: false },
  { type: 'openai', icon: '◉', name: 'OpenAI', desc: '官方', api: 'openai-completions', baseUrl: 'https://api.openai.com/v1', auth: true },
  { type: 'gemini', icon: '✦', name: 'Gemini', desc: 'Google', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', auth: false },
] as const;

export const TYPE_LABEL: Record<string, string> = {
  'openai-compatible': 'OpenAI 兼容', anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini',
};

async function rpc<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        ...(data ?? {}),
        ok: false,
        error: typeof data?.error === 'string' ? data.error : `请求失败 (HTTP ${res.status})`,
      } as T;
    }
    if (!data) return { ok: false, error: '服务返回了无法解析的响应' } as T;
    return data as T;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as T;
  }
}

export const api = {
  state: () => rpc<State>('/api/state'),
  saveProvider: (p: Partial<ProviderCfg>) => rpc<{ ok: boolean; id?: string; error?: string }>('/api/providers', 'POST', p),
  deleteProvider: (id: string) => rpc<{ ok: boolean; error?: string }>(`/api/providers/${id}`, 'DELETE'),
  apply: () => rpc<{ ok: boolean; backup?: string; error?: string }>('/api/apply', 'POST'),
  restore: (name: string) => rpc<{ ok: boolean; error?: string }>('/api/restore', 'POST', { name }),
  fetchModels: (baseUrl: string, apiKey: string | undefined, api: string, headers?: Record<string, string>, providerId?: string) =>
    rpc<{ ok: boolean; models?: string[]; source?: string; error?: string }>('/api/fetch-models', 'POST', { baseUrl, apiKey, api, headers, providerId }),
  test: (id: string, modelId: string, effort: string) =>
    rpc<{ ok: boolean; streamed?: boolean; totalMs?: number; ttftMs?: number | null; firstByteMs?: number | null; text?: string; usage?: unknown; status?: number; error?: string }>('/api/test', 'POST', { id, modelId, effort }),
  importFromCurrent: () => rpc<{ ok: boolean; imported?: string[]; error?: string }>('/api/import', 'POST'),
  exportYaml: () => rpc<{ ok: boolean; yaml?: string }>('/api/export'),
};

export function defaultModel(id: string, providerType?: string): ModelCfg {
  return {
    id,
    reasoning: true,
    contextWindow: providerType === 'anthropic' ? 1000000 : 250000,
    maxTokens: 128000,
    limitsEstimated: true,
    thinking: { mode: 'effort', minLevel: 'low', maxLevel: 'high' },
    compat: { supportsReasoningEffort: true, maxTokensField: providerType === 'anthropic' ? 'max_tokens' : 'max_completion_tokens' },
  };
}
