import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { api, type BackupInfo } from '@/lib/api';
import { useApp } from '@/lib/app';

const TRIGGER_LABELS: Record<BackupInfo['trigger'], string> = {
  apply: '应用前版本',
  restore: '恢复前版本',
  legacy: '历史版本',
};

function timeAgo(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} 分钟前`;
  if (min < 1440) return `${Math.round(min / 60)} 小时前`;
  return `${Math.round(min / 1440)} 天前`;
}

export function BackupSection() {
  const { state, refresh, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState('');
  const backups = state?.backups ?? [];

  const restore = async (backup: BackupInfo) => {
    const time = new Date(backup.mtime).toLocaleString();
    if (!confirm(`将配置恢复到 ${time} 的版本。当前配置会先自动保存。`)) return;
    setRestoring(backup.name);
    try {
      const r = await api.restore(backup.name);
      if (r.ok) { toast('已恢复并同步到编辑区'); await refresh(); } else toast(r.error || '恢复失败', 'err');
    } finally {
      setRestoring('');
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          可恢复版本 ({backups.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 max-w-2xl">
        <p className="mb-2 text-xs text-muted-foreground">应用或恢复配置前，会自动保存当时的配置，最多保留 10 份。</p>
        {!backups.length ? (
          <p className="text-sm text-muted-foreground">暂无可恢复版本</p>
        ) : (
          <div className="divide-y">
            {backups.map(b => (
              <div key={b.name} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">
                  <span className="block text-foreground">{TRIGGER_LABELS[b.trigger]} · {new Date(b.mtime).toLocaleString()}</span>
                  <span className="text-xs">{timeAgo(b.mtime)} · {b.providerCount ?? '未知'} 个供应商 · {(b.size / 1024).toFixed(1)}KB</span>
                </span>
                <Button size="sm" variant="ghost" disabled={!!restoring} onClick={() => restore(b)}>
                  {restoring === b.name ? '恢复中…' : '恢复'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
