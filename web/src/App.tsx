import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Import, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { BackupSection } from '@/components/BackupSection';
import { ProviderCard } from '@/components/ProviderCard';
import { ProviderModal } from '@/components/ProviderModal';
import { TestDialog } from '@/components/TestDialog';
import type { ProviderCfg } from '@/lib/api';

export default function App() {
  const { state, loading, loadError, refresh, toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderCfg | null>(null);
  const [duplicate, setDuplicate] = useState<ProviderCfg | null>(null);
  const [testing, setTesting] = useState<ProviderCfg | null>(null);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const manualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refresh(),
        new Promise(resolve => setTimeout(resolve, 600)),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await api.apply();
      if (r.ok) { toast('已写入 models.yml'); await refresh(); } else toast(r.error || '应用失败', 'err');
    } finally {
      setApplying(false);
    }
  };

  const doImport = async () => {
    if (!state?.current?.exists) { toast('没有可导入的配置', 'err'); return; }
    const r = await api.importFromCurrent();
    if (r.ok) { toast(`已导入 ${r.imported?.join(', ')}`); await refresh(); } else toast(r.error || '导入失败', 'err');
  };

  const doExport = async () => {
    const r = await api.exportYaml();
    if (!r.ok || !r.yaml) { toast('导出失败', 'err'); return; }
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([r.yaml], { type: 'text/yaml' }));
    a.href = url;
    a.download = 'omp-models.yml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const liveIds = new Set((state?.current?.providers ?? []).map(p => p.id));
  const enabledCount = state?.current?.enabledCount ?? 0;
  const dirty = state?.current?.hasUnappliedChanges ?? false;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">OMP <span className="text-primary">Provider</span></h1>
          <p className="text-xs text-muted-foreground">管理 ~/.omp/agent/models.yml 的供应商与模型</p>
        </div>
        <div className="flex items-center gap-2">
          {enabledCount > 0
            ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{enabledCount} 个供应商生效中</Badge>
            : <Badge variant="outline">未应用</Badge>}
          <Button variant="ghost" size="icon" onClick={manualRefresh} disabled={refreshing}
            title={refreshing ? '刷新中…' : '刷新'} aria-label={refreshing ? '刷新中' : '刷新'}>
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={doImport}>
            <Import className="size-3.5" /> 从 OMP 导入
          </Button>
          <Button variant="outline" size="sm" onClick={doExport}>
            <Download className="size-3.5" /> 导出 YAML
          </Button>
          <Button onClick={apply} disabled={applying || !dirty}>{applying ? '写入中…' : dirty ? '应用到 omp' : '已同步'}</Button>
        </div>
      </header>

      {dirty && (
        <div role="status" className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>编辑区有尚未应用的更改，OMP 当前配置不会自动变化。</span>
          <Button size="sm" onClick={apply} disabled={applying}>{applying ? '写入中…' : '立即应用'}</Button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => refresh()}>重试</Button>
        </div>
      )}

      <section className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">供应商</h2>
          <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ 添加供应商</Button>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
        ) : loadError ? null : !state?.providers.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">还没有供应商，点击"添加供应商"创建</p>
        ) : (
          <div className="space-y-2.5">
            {state.providers.map(p => (
              <ProviderCard key={p.id} p={p} live={liveIds.has(p.id)}
                onEdit={() => { setDuplicate(null); setEditing(p); setModalOpen(true); }}
                onTest={() => setTesting(p)}
                onDuplicate={() => { setEditing(null); setDuplicate(p); setModalOpen(true); }} />
            ))}
          </div>
        )}
      </section>

      <BackupSection />

      {modalOpen && (
        <ProviderModal open={modalOpen} editing={editing} duplicate={duplicate} onClose={() => { setModalOpen(false); setDuplicate(null); }} />
      )}
      {testing && (
        <TestDialog provider={testing} open={!!testing} onClose={() => setTesting(null)} />
      )}
    </div>
  );
}
