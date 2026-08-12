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
  const { state, loading, refresh, toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderCfg | null>(null);
  const [duplicate, setDuplicate] = useState<ProviderCfg | null>(null);
  const [testing, setTesting] = useState<ProviderCfg | null>(null);
  const [applying, setApplying] = useState(false);

  const apply = async () => {
    setApplying(true);
    const r = await api.apply();
    setApplying(false);
    if (r.ok) { toast('已写入 models.yml'); refresh(); } else toast(r.error || '应用失败', 'err');
  };

  const doImport = async () => {
    if (!state?.current?.exists) { toast('没有可导入的配置', 'err'); return; }
    const r = await api.importFromCurrent(state.current.raw);
    if (r.ok) { toast(`已导入 ${r.imported?.join(', ')}`); refresh(); } else toast(r.error || '导入失败', 'err');
  };

  const doExport = async () => {
    const r = await api.exportYaml();
    if (!r.ok || !r.yaml) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.yaml], { type: 'text/yaml' }));
    a.download = 'omp-models.yml';
    a.click();
  };

  const liveIds = new Set((state?.current?.providers ?? []).map(p => p.id));
  const enabledCount = state?.current?.enabledCount ?? 0;

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
          <Button variant="ghost" size="icon" onClick={refresh} title="刷新">
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={doImport}>
            <Import className="size-3.5" /> 导入
          </Button>
          <Button variant="outline" size="sm" onClick={doExport}>
            <Download className="size-3.5" /> 导出
          </Button>
          <Button onClick={apply} disabled={applying}>{applying ? '写入中…' : '应用到 omp'}</Button>
        </div>
      </header>

      <section className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">供应商</h2>
          <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>＋ 添加供应商</Button>
        </div>
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
        ) : !state?.providers.length ? (
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
