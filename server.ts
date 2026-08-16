// omp 供应商配置管理器 - 后端服务
// 功能设计参考: CC Switch(供应商卡片/预设/导入导出备份) + CLIProxyAPI 生态(类型驱动添加/拉取模型/流式健康检测)
// 零框架依赖, bun 运行: bun server.ts
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { FILES as EMBEDDED } from './embedded';

const HOME = homedir();
// 数据目录（供应商配置、Key），固定放在 ~/.omp/omp-switch
const DATA_DIR = join(HOME, '.omp', 'omp-switch');
const STORE_FILE = join(DATA_DIR, 'providers.json');
// 源码目录（静态资源 fallback，开发模式）
const SRC_DIR = import.meta.dir;
const MODELS_YML = join(HOME, '.omp', 'agent', 'models.yml');
const PORT = parseInt(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? process.env.OMP_SWITCHER_PORT ?? '8642', 10);

// ---------- 类型 ----------
interface ThinkingCfg { mode?: string; minLevel?: string; maxLevel?: string }
interface ModelCompat {
  supportsReasoningEffort?: boolean;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  thinkingFormat?: 'openai' | 'openrouter' | 'zai' | 'qwen' | 'qwen-chat-template';
  reasoningContentField?: 'reasoning_content' | 'reasoning' | 'reasoning_text';
  reasoningEffortMap?: Record<string, string>;
  requiresReasoningContentForToolCalls?: boolean;
  requiresThinkingAsText?: boolean;
}
interface ModelCfg {
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
interface ProviderCfg {
  id: string;
  name: string;
  type: 'openai-compatible' | 'anthropic' | 'openai' | 'gemini';
  api: string;
  baseUrl: string;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  models: ModelCfg[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  extra?: Record<string, unknown>;
}
interface Store { providers: ProviderCfg[] }

const API_OPTIONS: Record<string, { label: string; defaultBaseUrl: string; keyHeader: string }> = {
  'openai-completions': { label: 'OpenAI 兼容 (chat/completions)', defaultBaseUrl: 'https://api.openai.com/v1', keyHeader: 'Authorization: Bearer' },
  'openai-responses': { label: 'OpenAI Responses', defaultBaseUrl: 'https://api.openai.com/v1', keyHeader: 'Authorization: Bearer' },
  'anthropic-messages': { label: 'Anthropic Messages', defaultBaseUrl: 'https://api.anthropic.com', keyHeader: 'x-api-key' },
  'google-generative-ai': { label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHeader: 'x-goog-api-key' },
};

// ---------- 存储 ----------
function loadStore(): Store {
  if (!existsSync(STORE_FILE)) return { providers: [] };
  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as Partial<Store>;
    if (!Array.isArray(parsed.providers)) throw new Error('providers 字段不是数组');
    return { providers: parsed.providers };
  } catch (e) {
    throw new Error(`providers.json 读取失败，请保留文件并检查内容：${e instanceof Error ? e.message : String(e)}`);
  }
}
function atomicWriteFile(file: string, content: string, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  let fd: number | null = null;
  try {
    writeFileSync(tempFile, content, { mode });
    fd = openSync(tempFile, 'r');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempFile, file);
    chmodSync(file, mode);
  } catch (e) {
    if (fd !== null) closeSync(fd);
    if (existsSync(tempFile)) unlinkSync(tempFile);
    throw e;
  }
}
function saveStore(s: Store) {
  atomicWriteFile(STORE_FILE, JSON.stringify(s, null, 2));
}

// 旧版 profiles.json（档案=YAML 文本）迁移为 providers 数组
function migrateLegacy() {
  // 旧版数据目录（~/.omp/provider-switcher）迁移
  const oldDir = join(HOME, '.omp', 'provider-switcher');
  const oldStore = join(oldDir, 'providers.json');
  if (existsSync(oldStore) && !existsSync(STORE_FILE)) {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      copyFileSync(oldStore, STORE_FILE);
      console.log('已迁移数据目录: provider-switcher -> omp-switch');
    } catch (e) { console.error('数据迁移失败:', String(e)); }
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const legacyFile = join(DATA_DIR, 'profiles.json');
  if (!existsSync(legacyFile)) return;
  let legacy: { profiles?: { id?: string; name?: string; yaml?: string }[] } = {};
  try { legacy = JSON.parse(readFileSync(legacyFile, 'utf8')); } catch (e) {
    console.error('旧版 profiles.json 解析失败，已保留原文件:', e);
    return;
  }
  if (!legacy.profiles?.length) return;
  const store = loadStore();
  if (store.providers.length) {
    const result = Bun.spawnSync(['rm', '-f', legacyFile]);
    if (!result.success) console.error('旧版 profiles.json 清理失败:', result.stderr.toString());
    return;
  }
  for (const p of legacy.profiles) {
    if (!p.yaml) continue;
    const converted = yamlToProviders(p.yaml);
    for (const np of converted) {
      if (!store.providers.some((x) => x.id === np.id)) store.providers.push(np);
    }
  }
  saveStore(store);
  const result = Bun.spawnSync(['rm', '-f', legacyFile]);
  if (!result.success) console.error('旧版 profiles.json 清理失败:', result.stderr.toString());
}

// ---------- YAML 转换 ----------
function providersToYaml(providers: ProviderCfg[]): string {
  const root: Record<string, unknown> = {};
  for (const p of providers.filter((x) => x.enabled)) {
    const entry: Record<string, unknown> = { ...(p.extra ?? {}), baseUrl: p.baseUrl, api: p.api };
    if (p.apiKey) entry.apiKey = p.apiKey;
    if (p.authHeader) entry.authHeader = true;
    if (p.headers && Object.keys(p.headers).length) entry.headers = p.headers;
    entry.models = p.models.map((m) => {
      const e: Record<string, unknown> = { ...(m.extra ?? {}), id: m.id };
      if (m.name) e.name = m.name;
      if (m.reasoning) e.reasoning = true;
      if (m.thinking && (m.thinking.mode || m.thinking.minLevel || m.thinking.maxLevel)) e.thinking = m.thinking;
      if (m.input?.length) e.input = m.input;
      if (m.contextWindow) e.contextWindow = m.contextWindow;
      if (m.maxTokens) e.maxTokens = m.maxTokens;
      if (m.compat && Object.keys(m.compat).length) e.compat = m.compat;
      return e;
    });
    root[p.id] = entry;
  }
  return `# 由 omp 供应商配置器生成\n${yamlStringify({ providers: root })}`;
}

function yamlToProviders(yaml: string): ProviderCfg[] {
  let parsed: unknown;
  try { parsed = yamlParse(yaml); } catch (e) {
    throw new Error(`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const providers = (parsed as { providers?: Record<string, Record<string, unknown>> })?.providers;
  if (!providers) return [];
  const now = Date.now();
  return Object.entries(providers).map(([id, cfg]) => {
    const models = (cfg.models as Record<string, unknown>[] | undefined) ?? [];
    const providerKnown = new Set(['name', 'baseUrl', 'api', 'apiKey', 'authHeader', 'headers', 'models']);
    const extra = Object.fromEntries(Object.entries(cfg).filter(([key]) => !providerKnown.has(key)));
    return {
      id,
      name: (cfg.name as string) ?? id,
      type: detectType(cfg.api as string | undefined, cfg.baseUrl as string),
      api: (cfg.api as string) ?? 'openai-completions',
      baseUrl: (cfg.baseUrl as string) ?? '',
      apiKey: cfg.apiKey as string | undefined,
      authHeader: cfg.authHeader as boolean | undefined,
      headers: cfg.headers as Record<string, string> | undefined,
      models: models.map((m) => {
        const modelKnown = new Set(['id', 'name', 'reasoning', 'thinking', 'input', 'contextWindow', 'maxTokens', 'compat']);
        return {
          id: m.id as string,
          name: m.name as string | undefined,
          reasoning: m.reasoning as boolean | undefined,
          thinking: m.thinking as ThinkingCfg | undefined,
          input: m.input as string[] | undefined,
          contextWindow: m.contextWindow as number | undefined,
          maxTokens: m.maxTokens as number | undefined,
          compat: m.compat as ModelCompat | undefined,
          extra: Object.fromEntries(Object.entries(m).filter(([key]) => !modelKnown.has(key))),
        };
      }),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      extra,
    };
  });
}

function detectType(api: string | undefined, baseUrl: string): ProviderCfg['type'] {
  if (api === 'anthropic-messages') return 'anthropic';
  if (api === 'google-generative-ai') return 'gemini';
  if (api === 'openai-responses' || api === 'openai-codex-responses') return 'openai';
  const u = baseUrl.toLowerCase();
  if (u.includes('api.openai.com') || u.includes('api.anthropic.com') || u.includes('generativelanguage')) {
    if (u.includes('anthropic')) return 'anthropic';
    if (u.includes('generativelanguage')) return 'gemini';
    return 'openai';
  }
  return 'openai-compatible';
}

// ---------- 当前配置 ----------
function currentState(draftProviders: ProviderCfg[]) {
  if (!existsSync(MODELS_YML)) {
    return { exists: false, providers: [], enabledCount: 0, hasUnappliedChanges: draftProviders.some((p) => p.enabled) };
  }
  const raw = readFileSync(MODELS_YML, 'utf8');
  const providers = yamlToProviders(raw);
  const currentCanonical = yamlStringify(yamlParse(raw), { sortMapEntries: true });
  const draftCanonical = yamlStringify(yamlParse(providersToYaml(draftProviders)), { sortMapEntries: true });
  return {
    exists: true,
    providers: providers.map((provider) => ({
      ...provider,
      apiKeyMasked: maskKey(provider.apiKey),
      apiKey: undefined,
    })),
    enabledCount: providers.length,
    hasUnappliedChanges: currentCanonical !== draftCanonical,
  };
}

// ---------- 备份 ----------
function backupDir() { return join(HOME, '.omp', 'agent', 'backups'); }
function listBackups() {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith('models.yml.bak-')).map((f) => {
    const p = join(dir, f);
    const st = statSync(p);
    let providerCount: number | null = null;
    try {
      const parsed = yamlParse(readFileSync(p, 'utf8')) as { providers?: Record<string, unknown> };
      providerCount = parsed.providers ? Object.keys(parsed.providers).length : 0;
    } catch {}
    const trigger = f.startsWith('models.yml.bak-apply-')
      ? 'apply'
      : f.startsWith('models.yml.bak-restore-') ? 'restore' : 'legacy';
    return { name: f, size: st.size, mtime: st.mtimeMs, providerCount, trigger };
  }).sort((a, b) => b.mtime - a.mtime);
}
function makeBackup(trigger: 'apply' | 'restore') {
  if (!existsSync(MODELS_YML)) return null;
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `models.yml.bak-${trigger}-${ts}`;
  copyFileSync(MODELS_YML, join(dir, name));
  const all = listBackups();
  for (const b of all.slice(10)) {
    const result = Bun.spawnSync(['rm', '-f', join(dir, b.name)]);
    if (!result.success) console.error(`旧备份清理失败: ${b.name}`, result.stderr.toString());
  }
  return name;
}
function applyToModelsYml(providers: ProviderCfg[]) {
  const backup = makeBackup('apply');
  const yaml = providersToYaml(providers);
  atomicWriteFile(MODELS_YML, yaml);
  return backup;
}

// ---------- BaseUrl 归一化 ----------
function normalizeBaseUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/(chat\/completions|messages|responses|generateContent|models)?\/?$/i, '');
  u = u.replace(/\/v1(beta)?\/?$/i, '');
  return u.replace(/\/+$/, '');
}

// ---------- 拉取模型列表 ----------
function modelEndpointCandidates(baseUrl: string, api: string): string[] {
  const base = normalizeBaseUrl(baseUrl);
  if (api === 'google-generative-ai') return [`${base}/v1beta/models`];
  if (api === 'anthropic-messages') return [`${base}/v1/models`, `${base}/models`];
  return [`${base}/v1/models`, `${base}/models`];
}
function modelAuthHeaders(api: string, apiKey: string): Record<string, string> {
  if (api === 'anthropic-messages') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  if (api === 'google-generative-ai') return { 'x-goog-api-key': apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}
async function fetchModels(baseUrl: string, apiKey: string | undefined, api: string, headers?: Record<string, string>): Promise<{ models: string[]; source: string }> {
  if (!apiKey) throw new Error('需要 API Key 才能拉取模型列表');
  const candidates = modelEndpointCandidates(baseUrl, api);
  const authHeaders = modelAuthHeaders(api, apiKey);
  let lastErr = '';
  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { headers: { ...authHeaders, ...(headers ?? {}) }, signal: ctrl.signal });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error(`凭证无效 (HTTP ${res.status})，请检查 API Key`);
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const j = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string }[] };
      const ids = Array.isArray(j.data) ? j.data.map((m) => m.id).filter(Boolean)
        : Array.isArray(j.models) ? j.models.map((m) => m.name?.replace(/^models\//, '')).filter(Boolean)
        : [];
      if (ids.length) return { models: ids as string[], source: url };
      lastErr = '响应中没有模型数据';
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('凭证无效')) throw e;
      lastErr = String(e).slice(0, 100);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`拉取失败: ${lastErr || '所有候选端点不可用'}`);
}

// ---------- 测试(流式首字延迟) ----------
function thinkingParams(compat: ModelCompat | undefined, effort: string): Record<string, unknown> {
  const format = compat?.thinkingFormat ?? 'openai';
  const mapped = compat?.reasoningEffortMap?.[effort] ?? effort;
  if (format === 'openrouter') return { reasoning: { effort: mapped } };
  if (format === 'zai') return { thinking: { type: 'enabled' } };
  if (format === 'qwen') return { enable_thinking: true };
  if (format === 'qwen-chat-template') return { chat_template_kwargs: { enable_thinking: true } };
  return { reasoning_effort: mapped };
}

async function testModel(provider: ProviderCfg, modelId: string, effort: string) {
  const model = provider.models.find((m) => m.id === modelId);
  const base = normalizeBaseUrl(provider.baseUrl);
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let firstByte: number | null = null;
  let firstContent: number | null = null;
  let text = '';
  let usage: unknown = null;
  try {
    if (provider.api === 'anthropic-messages') {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { ...modelAuthHeaders(provider.api, provider.apiKey ?? ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: '请回复：连接正常。' }], max_tokens: 64, stream: true }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300), totalMs: Date.now() - t0 };
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = Date.now();
        if (firstByte === null) firstByte = now;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const j = JSON.parse(line.slice(5).trim());
            if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
              if (firstContent === null) firstContent = now;
              text += j.delta.text;
            }
            if (j.type === 'message_delta' && j.usage) usage = j.usage;
          } catch {}
        }
      }
    } else if (provider.api === 'openai-responses') {
      const res = await fetch(`${base}/v1/responses`, {
        method: 'POST',
        headers: { ...modelAuthHeaders(provider.api, provider.apiKey ?? ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, input: '请回复：连接正常。', stream: false, max_output_tokens: 64 }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300), totalMs: Date.now() - t0 };
      const j = (await res.json()) as { output?: { content?: { text?: string }[] }[]; usage?: unknown };
      firstByte = Date.now(); firstContent = firstByte;
      text = j.output?.[0]?.content?.map((c) => c.text ?? '').join('') ?? '';
      usage = j.usage;
    } else if (provider.api === 'google-generative-ai') {
      const res = await fetch(`${base}/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(provider.apiKey ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '请回复：连接正常。' }] }], generationConfig: { maxOutputTokens: 64 } }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300), totalMs: Date.now() - t0 };
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      firstByte = Date.now(); firstContent = firstByte;
      text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    } else {
      // openai-completions
      const body: Record<string, unknown> = {
        model: modelId,
        messages: [{ role: 'user', content: '请回复：连接正常。' }],
        stream: true,
      };
      if (model?.compat?.maxTokensField === 'max_tokens') body.max_tokens = 64;
      else body.max_completion_tokens = 64;
      if (effort && (model?.reasoning || model?.compat?.supportsReasoningEffort)) Object.assign(body, thinkingParams(model?.compat, effort));
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { ...modelAuthHeaders(provider.api, provider.apiKey ?? ''), ...(provider.headers ?? {}), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300), totalMs: Date.now() - t0 };
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = Date.now();
        if (firstByte === null) firstByte = now;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]') continue;
          try {
            const j = JSON.parse(d);
            const delta = j.choices?.[0]?.delta;
            if (typeof delta?.content === 'string' && delta.content.length) {
              if (firstContent === null) firstContent = now;
              text += delta.content;
            }
            if (j.usage) usage = j.usage;
          } catch {}
        }
      }
    }
    return {
      ok: true,
      streamed: provider.api === 'anthropic-messages' || provider.api === 'openai-completions',
      totalMs: Date.now() - t0,
      ttftMs: firstContent !== null ? firstContent - t0 : null,
      firstByteMs: firstByte !== null ? firstByte - t0 : null,
      text: text.slice(0, 100),
      usage: usage as { prompt_tokens?: number; completion_tokens?: number } | null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? '120s 超时' : String(e).slice(0, 200), totalMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 校验 ----------
function validateProvider(p: Partial<ProviderCfg>): string | null {
  if (!p.id?.trim() || !/^[a-z0-9-]+$/.test(p.id)) return 'provider id 必须是小写字母/数字/连字符';
  if (!p.name?.trim()) return '供应商名称不能为空';
  if (!p.baseUrl?.trim() || !/^https?:\/\//i.test(p.baseUrl.trim())) return 'baseUrl 必须是 http(s) 地址';
  if (!p.models?.length) return '至少需要一个模型';
  if (p.models.some((m) => !m.id?.trim())) return '模型 id 不能为空';
  if (p.models.some((m) => !m.contextWindow)) return '模型缺少 contextWindow';
  if (p.models.some((m) => !m.maxTokens)) return '模型缺少 maxTokens';
  if (p.models.some((m) => !Number.isInteger(m.contextWindow) || m.contextWindow! <= 0)) return 'contextWindow 必须是正整数';
  if (p.models.some((m) => !Number.isInteger(m.maxTokens) || m.maxTokens! <= 0)) return 'maxTokens 必须是正整数';
  if (new Set(p.models.map((m) => m.id.trim())).size !== p.models.length) return '模型 id 不能重复';
  if (p.headers && (Array.isArray(p.headers) || Object.values(p.headers).some((value) => typeof value !== 'string'))) return 'headers 必须是字符串键值对';
  return null;
}

// ---------- 响应 ----------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function maskKey(k?: string) {
  if (!k) return '';
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '***';
}

// ---------- HTTP ----------
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    try {
      const url = new URL(req.url);
      const p = url.pathname;

    if (p === '/api/health' && req.method === 'GET') {
      return json({ ok: true, service: 'omp-switch' });
    }

    if (p === '/' || p === '/index.html' || p === '/favicon.svg' || p.startsWith('/assets/')) {
      const rel = p === '/' ? '/index.html' : p;
      const mime: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', woff2: 'font/woff2' };
      const mimeOf = (path: string) => rel.endsWith('.html') ? 'text/html; charset=utf-8' : mime[path.split('.').pop() ?? ''] ?? 'application/octet-stream';
      // 1. 本机开发：优先读 web/dist 文件系统
      const distFile = join(SRC_DIR, 'web', 'dist', rel.slice(1));
      if (existsSync(distFile)) {
        return new Response(readFileSync(distFile), { headers: { 'Content-Type': mimeOf(rel) } });
      }
      // 2. Release 二进制：读取内嵌产物
      if (EMBEDDED[rel]) {
        return new Response(EMBEDDED[rel], { headers: { 'Content-Type': mimeOf(rel) } });
      }
      // 3. 旧版 fallback（本机开发，未构建 dist 时）
      try {
        const legacy = join(SRC_DIR, 'public', 'index.html');
        if (existsSync(legacy) && (p === '/' || p === '/index.html')) {
          return new Response(readFileSync(legacy), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      } catch {}
      return new Response('Not found', { status: 404 });
    }

    if (p === '/api/state' && req.method === 'GET') {
      try {
        const store = loadStore();
        if (!store.providers.length && existsSync(MODELS_YML)) {
          store.providers = yamlToProviders(readFileSync(MODELS_YML, 'utf8'));
          saveStore(store);
        }
        return json({
          providers: store.providers.map((x) => ({ ...x, apiKeyMasked: maskKey(x.apiKey), apiKey: undefined })),
          apiOptions: API_OPTIONS,
          current: currentState(store.providers),
          backups: listBackups(),
        });
      } catch (e) {
        return json({ error: `加载状态失败: ${e instanceof Error ? e.message : String(e)}` }, 500);
      }
    }

    if (p === '/api/providers' && req.method === 'POST') {
      const body = (await req.json()) as Partial<ProviderCfg>;
      body.name = body.name?.trim() || body.id?.trim();
      const err = validateProvider(body);
      if (err) return json({ error: err }, 400);
      const store = loadStore();
      const existing = store.providers.find((x) => x.id === body.id);
      const now = Date.now();
      if (existing) {
        if (!body.apiKey) body.apiKey = existing.apiKey;
        Object.assign(existing, body, { updatedAt: now });
      } else {
        store.providers.push({ ...(body as ProviderCfg), id: body.id!, createdAt: now, updatedAt: now });
      }
      saveStore(store);
      return json({ ok: true, id: body.id });
    }

    const del = p.match(/^\/api\/providers\/([\w-]+)$/);
    if (del && req.method === 'DELETE') {
      const store = loadStore();
      store.providers = store.providers.filter((x) => x.id !== del[1]);
      saveStore(store);
      return json({ ok: true });
    }

    if (p === '/api/apply' && req.method === 'POST') {
      const store = loadStore();
      if (!store.providers.some((x) => x.enabled)) return json({ error: '至少启用一个供应商' }, 400);
      const backup = applyToModelsYml(store.providers);
      return json({ ok: true, backup });
    }

    if (p === '/api/restore' && req.method === 'POST') {
      const { name } = (await req.json()) as { name: string };
      const dir = backupDir();
      if (!listBackups().some((backup) => backup.name === name)) return json({ error: '备份不存在' }, 404);
      const file = join(dir, name);
      const backup = makeBackup('restore');
      const restoredYaml = readFileSync(file, 'utf8');
      const restoredProviders = yamlToProviders(restoredYaml);
      atomicWriteFile(MODELS_YML, restoredYaml);

      const store = loadStore();
      const now = Date.now();
      const restoredById = new Map(restoredProviders.map((provider) => [provider.id, provider]));
      store.providers = store.providers.map((provider) => {
        const restored = restoredById.get(provider.id);
        if (!restored) return { ...provider, enabled: false, updatedAt: now };
        restoredById.delete(provider.id);
        return {
          ...provider,
          ...restored,
          name: provider.name,
          enabled: true,
          createdAt: provider.createdAt,
          updatedAt: now,
        };
      });
      for (const restored of restoredById.values()) store.providers.push({ ...restored, updatedAt: now });
      saveStore(store);
      return json({ ok: true, backup });
    }

    if (p === '/api/fetch-models' && req.method === 'POST') {
      const { baseUrl, apiKey, api, headers, providerId } = (await req.json()) as { baseUrl: string; apiKey?: string; api: string; headers?: Record<string, string>; providerId?: string };
      // 编辑已有供应商时直接用服务端存储的 key，前端无需再传
      let effBaseUrl = baseUrl, effApiKey = apiKey, effApi = api, effHeaders = headers;
      if (providerId) {
        const store = loadStore();
        const storedProvider = store.providers.find((x) => x.id === providerId);
        if (storedProvider && !effApiKey) effApiKey = storedProvider.apiKey;
      }
      if (!effBaseUrl) return json({ error: '请先填写 baseUrl' }, 400);
      try {
        const result = await fetchModels(effBaseUrl, effApiKey, effApi, effHeaders);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 400);
      }
    }

    if (p === '/api/test' && req.method === 'POST') {
      const { id, modelId, effort } = (await req.json()) as { id: string; modelId: string; effort?: string };
      const store = loadStore();
      const provider = store.providers.find((x) => x.id === id);
      if (!provider) return json({ error: '供应商不存在' }, 404);
      if (!provider.models.some((m) => m.id === modelId)) return json({ error: `模型 ${modelId} 不在该供应商配置中` }, 400);
      return json(await testModel(provider, modelId, effort ?? 'medium'));
    }

    if (p === '/api/import' && req.method === 'POST') {
      if (!existsSync(MODELS_YML)) return json({ error: '当前 models.yml 不存在' }, 404);
      const yaml = readFileSync(MODELS_YML, 'utf8');
      const providers = yamlToProviders(yaml);
      if (!providers.length) return json({ error: '未解析到 providers 配置' }, 400);
      const store = loadStore();
      for (const np of providers) {
        const existing = store.providers.find((x) => x.id === np.id);
        if (existing) Object.assign(existing, np, { updatedAt: Date.now() });
        else store.providers.push(np);
      }
      saveStore(store);
      return json({ ok: true, imported: providers.map((x) => x.id) });
    }

    if (p === '/api/export' && req.method === 'GET') {
      const store = loadStore();
      return json({ ok: true, yaml: providersToYaml(store.providers) });
    }

    return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('请求处理失败:', e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
});

migrateLegacy();
console.log(`OMP_SWITCH_READY http://127.0.0.1:${PORT}`);
