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

async function startServer(home: string) {
  const port = reservePort();
  const child = Bun.spawn([process.execPath, 'server.ts', `--port=${port}`], {
    cwd: projectRoot,
    env: { ...process.env, HOME: home },
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
});
