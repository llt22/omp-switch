import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';

const projectRoot = join(import.meta.dir, '..');
const processes: Bun.Subprocess[] = [];
const tempHomes: string[] = [];

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'omp-switch-test-'));
  tempHomes.push(home);
  mkdirSync(join(home, '.omp', 'agent'), { recursive: true });
  mkdirSync(join(home, '.omp', 'omp-switch'), { recursive: true });
  return home;
}

function reservePort() {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response('reserved') });
  const port = reservation.port;
  reservation.stop(true);
  return port;
}

async function startServer(home: string, extraEnv: Record<string, string> = {}) {
  const port = reservePort();
  const child = Bun.spawn([process.execPath, 'server.ts', `--port=${port}`], {
    cwd: projectRoot,
    env: { ...process.env, HOME: home, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  processes.push(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, child };
    } catch {}
    await Bun.sleep(50);
  }
  const stderr = await new Response(child.stderr).text();
  throw new Error(`服务启动失败：${stderr}`);
}

function provider(id: string, baseUrl: string, apiKey = 'test-key') {
  const now = Date.now();
  return {
    id,
    name: id,
    type: 'openai-compatible',
    api: 'openai-completions',
    baseUrl,
    apiKey,
    authHeader: true,
    models: [{
      id: 'model-a',
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 32000,
      compat: { thinkingFormat: 'openrouter', maxTokensField: 'max_tokens' },
    }],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

afterAll(() => {
  for (const child of processes) child.kill();
  for (const home of tempHomes) rmSync(home, { recursive: true, force: true });
});

describe('配置业务闭环', () => {
  test('供应商名称为空时默认使用 Provider ID', async () => {
    const home = makeHome();
    const { baseUrl } = await startServer(home);
    const unnamed = provider('alpha', 'https://alpha.example.com/v1');
    delete (unnamed as Partial<typeof unnamed>).name;

    const result = await fetch(`${baseUrl}/api/providers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(unnamed),
    }).then(r => r.json()) as { ok: boolean };
    expect(result.ok).toBe(true);

    const state = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as {
      providers: { id: string; name: string }[];
    };
    expect(state.providers[0]).toMatchObject({ id: 'alpha', name: 'alpha' });
  });

  test('导入导出保留未知字段，并且状态接口不暴露原始 YAML', async () => {
    const home = makeHome();
    writeFileSync(join(home, '.omp', 'agent', 'models.yml'), `providers:
  alpha:
    baseUrl: https://alpha.example.com/v1
    api: openai-completions
    apiKey: secret-alpha
    customProviderField: keep-provider
    models:
      - id: model-a
        contextWindow: 128000
        maxTokens: 32000
        customModelField: keep-model
        compat:
          thinkingFormat: openrouter
          maxTokensField: max_tokens
          requiresReasoningContentForToolCalls: true
`);
    const { baseUrl } = await startServer(home);

    const state = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as Record<string, unknown>;
    expect((state.current as Record<string, unknown>).raw).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('secret-alpha');

    const exported = await fetch(`${baseUrl}/api/export`).then(r => r.json()) as { yaml: string };
    const parsed = parseYaml(exported.yaml);
    expect(parsed.providers.alpha.customProviderField).toBe('keep-provider');
    expect(parsed.providers.alpha.models[0].customModelField).toBe('keep-model');
    expect(parsed.providers.alpha.models[0].compat.thinkingFormat).toBe('openrouter');
    expect(parsed.providers.alpha.models[0].compat.requiresReasoningContentForToolCalls).toBe(true);
    expect(statSync(join(home, '.omp', 'omp-switch', 'providers.json')).mode & 0o777).toBe(0o600);
  });

  test('恢复备份后同步编辑区，下一次应用不会撤销恢复', async () => {
    const home = makeHome();
    writeFileSync(join(home, '.omp', 'agent', 'models.yml'), `providers:
  alpha:
    baseUrl: https://original.example.com/v1
    api: openai-completions
    apiKey: original-key
    models:
      - id: model-a
        contextWindow: 128000
        maxTokens: 32000
`);
    const { baseUrl } = await startServer(home);
    await fetch(`${baseUrl}/api/state`);

    const changed = provider('alpha', 'https://changed.example.com/v1', 'changed-key');
    expect((await fetch(`${baseUrl}/api/providers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changed),
    }).then(r => r.json()) as { ok: boolean }).ok).toBe(true);
    expect((await fetch(`${baseUrl}/api/apply`, { method: 'POST' }).then(r => r.json()) as { ok: boolean }).ok).toBe(true);

    const afterApply = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as {
      backups: { name: string; trigger: string; providerCount: number | null }[];
    };
    const backupName = afterApply.backups[0].name;
    expect(afterApply.backups[0].trigger).toBe('apply');
    expect(afterApply.backups[0].providerCount).toBe(1);
    expect((await fetch(`${baseUrl}/api/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: backupName }),
    }).then(r => r.json()) as { ok: boolean }).ok).toBe(true);

    const restored = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as {
      providers: { baseUrl: string; enabled: boolean }[];
      current: { hasUnappliedChanges: boolean };
    };
    expect(restored.providers[0].baseUrl).toBe('https://original.example.com/v1');
    expect(restored.providers[0].enabled).toBe(true);
    expect(restored.current.hasUnappliedChanges).toBe(false);
    const afterRestore = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as { backups: { trigger: string }[] };
    expect(afterRestore.backups.some(backup => backup.trigger === 'restore')).toBe(true);
    expect(statSync(join(home, '.omp', 'agent', 'models.yml')).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(home, '.omp', 'agent')).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  test('providers.json 损坏时显式失败且不覆盖原文件', async () => {
    const home = makeHome();
    const storeFile = join(home, '.omp', 'omp-switch', 'providers.json');
    writeFileSync(storeFile, '{broken');
    writeFileSync(join(home, '.omp', 'agent', 'models.yml'), 'providers: {}\n');
    const { baseUrl } = await startServer(home);

    const response = await fetch(`${baseUrl}/api/state`);
    const result = await response.json() as { error: string };
    expect(response.status).toBe(500);
    expect(result.error).toContain('providers.json 读取失败');
    expect(readFileSync(storeFile, 'utf8')).toBe('{broken');
  });

  test('编辑供应商拉取模型时使用新地址，只从存储补 API Key', async () => {
    let requestedPath = '';
    let authorization = '';
    const upstream = Bun.serve({
      port: 0,
      fetch(req) {
        requestedPath = new URL(req.url).pathname;
        authorization = req.headers.get('authorization') ?? '';
        return Response.json({ data: [{ id: 'new-model' }] });
      },
    });
    try {
      const home = makeHome();
      writeFileSync(join(home, '.omp', 'omp-switch', 'providers.json'), JSON.stringify({
        providers: [provider('alpha', 'https://old.example.com/v1', 'stored-key')],
      }));
      const { baseUrl } = await startServer(home);
      const result = await fetch(`${baseUrl}/api/fetch-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'alpha',
          baseUrl: `http://127.0.0.1:${upstream.port}`,
          api: 'openai-completions',
        }),
      }).then(r => r.json()) as { ok: boolean; models: string[] };

      expect(result.ok).toBe(true);
      expect(result.models).toEqual(['new-model']);
      expect(requestedPath).toBe('/v1/models');
      expect(authorization).toBe('Bearer stored-key');
    } finally {
      upstream.stop(true);
    }
  });

  test('添加模型时使用 OMP 引用解析器补齐配置并保留原始 ID', async () => {
    const catalog = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          anthropic: {
            models: {
              'claude-opus-4-7': {
                name: 'Claude Opus 4.7',
                tool_call: true,
                reasoning: true,
                limit: { context: 1000000, output: 128000 },
                modalities: { input: ['text', 'image'] },
                cost: { input: 3, output: 15 },
              },
            },
          },
        });
      },
    });
    try {
      const home = makeHome();
      const { baseUrl } = await startServer(home, {
        OMP_SWITCH_CATALOG_URL: `http://127.0.0.1:${catalog.port}/models.json`,
      });
      const aliasId = 'vendor/claude-opus-4-7-thinking';
      const result = await fetch(`${baseUrl}/api/resolve-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [aliasId, 'unknown-model'],
          providerId: 'proxy',
          api: 'openai-completions',
          baseUrl: 'https://proxy.example.com/v1',
        }),
      }).then(response => response.json()) as {
        ok: boolean;
        matches: Array<{
          id: string;
          matched: boolean;
          reference?: { provider: string; id: string };
          model?: Record<string, any>;
        }>;
      };

      expect(result.ok).toBe(true);
      expect(result.matches[0]).toMatchObject({
        id: aliasId,
        matched: true,
        reference: { provider: 'anthropic', id: 'claude-opus-4-7' },
        model: {
          id: aliasId,
          contextWindow: 1000000,
          maxTokens: 128000,
          input: ['text', 'image'],
          reasoning: true,
          thinking: {
            mode: 'effort',
            efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
            requiresEffort: true,
          },
          compat: { thinkingFormat: 'openai', maxTokensField: 'max_completion_tokens' },
        },
      });
      expect(result.matches[1]).toEqual({ id: 'unknown-model', matched: false });

      const resolvedProvider = provider('proxy', 'https://proxy.example.com/v1');
      resolvedProvider.models = [{
        ...result.matches[0].model,
        catalog: {
          source: 'OMP 在线模型目录',
          referenceProvider: 'anthropic',
          referenceId: 'claude-opus-4-7',
        },
      } as any];
      const saved = await fetch(`${baseUrl}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolvedProvider),
      }).then(response => response.json()) as { ok: boolean };
      expect(saved.ok).toBe(true);
      const exported = await fetch(`${baseUrl}/api/export`).then(response => response.json()) as { yaml: string };
      const parsed = parseYaml(exported.yaml);
      expect(parsed.providers.proxy.models[0].id).toBe(aliasId);
      expect(parsed.providers.proxy.models[0].thinking.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(parsed.providers.proxy.models[0].catalog).toBeUndefined();
    } finally {
      catalog.stop(true);
    }
  });

  test('OMP 未匹配时允许仅保存模型 ID', async () => {
    const home = makeHome();
    const { baseUrl } = await startServer(home);
    const minimal = provider('minimal', 'https://minimal.example.com/v1');
    minimal.models = [{ id: 'private-model-id' }] as typeof minimal.models;

    const result = await fetch(`${baseUrl}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimal),
    }).then(response => response.json()) as { ok: boolean };
    expect(result.ok).toBe(true);

    const exported = await fetch(`${baseUrl}/api/export`).then(response => response.json()) as { yaml: string };
    expect(parseYaml(exported.yaml).providers.minimal.models).toEqual([{ id: 'private-model-id' }]);
  });

  test('删除供应商支持编码后的特殊 ID', async () => {
    const home = makeHome();
    const id = 'gateway.v2_test';
    writeFileSync(join(home, '.omp', 'omp-switch', 'providers.json'), JSON.stringify({
      providers: [provider(id, 'https://gateway.example.com/v1'), provider('keep', 'https://keep.example.com/v1')],
    }));
    const { baseUrl } = await startServer(home);

    const response = await fetch(`${baseUrl}/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const state = await fetch(`${baseUrl}/api/state`).then(r => r.json()) as { providers: { id: string }[] };
    expect(state.providers.map(p => p.id)).toEqual(['keep']);
  });
});
