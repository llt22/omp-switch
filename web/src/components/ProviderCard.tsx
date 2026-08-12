import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pencil, Trash2, FlaskConical, Power, PowerOff, Copy } from 'lucide-react';
import { api, TYPE_LABEL, type ProviderCfg } from '@/lib/api';
import { useApp } from '@/lib/app';

export function ProviderCard({ p, live, onEdit, onTest, onDuplicate }: {
  p: ProviderCfg;
  live: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDuplicate: () => void;
}) {
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    const r = await api.saveProvider({ ...p, enabled: !p.enabled, apiKey: undefined });
    setBusy(false);
    toast(r.ok ? (p.enabled ? '已停用' : '已启用') : r.error || '操作失败', r.ok ? 'ok' : 'err');
    refresh();
  };

  const del = async () => {
    if (!confirm(`删除供应商「${p.name}」？`)) return;
    await api.deleteProvider(p.id);
    toast('已删除');
    refresh();
  };

  const chips = p.models.slice(0, 3);
  const more = p.models.length - chips.length;

  return (
    <Card className="p-4 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight">{p.name}</span>
            <Badge variant="secondary" className="text-[11px]">{TYPE_LABEL[p.type] ?? p.type}</Badge>
            {live && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">生效中</Badge>}
            {!p.enabled && <Badge variant="outline" className="text-amber-600">已停用</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground break-all">
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{p.baseUrl}</code>
            <span className="mx-1">·</span>
            {p.models.length} 个模型 · key <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{p.apiKeyMasked || '—'}</code>
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {chips.map(m => (
              <span key={m.id} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${m.reasoning ? 'border-primary/30 text-primary' : 'border-border text-muted-foreground'}`}>
                {m.id}
              </span>
            ))}
            {more > 0 && <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">+{more}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <Button size="sm" variant={p.enabled ? 'outline' : 'default'} onClick={toggle} disabled={busy}>
            {p.enabled ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
            {p.enabled ? '停用' : '启用'}
          </Button>
          <Button size="sm" variant="outline" onClick={onTest}>
            <FlaskConical className="size-3.5" /> 测试
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" /> 编辑
          </Button>
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <Copy className="size-3.5" /> 复制
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={del}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
