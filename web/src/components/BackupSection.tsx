import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';

function timeAgo(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} 分钟前`;
  if (min < 1440) return `${Math.round(min / 60)} 小时前`;
  return `${Math.round(min / 1440)} 天前`;
}

export function BackupSection() {
  const { state, refresh, toast } = useApp();
  const [open, setOpen] = useState(false);
  const backups = state?.backups ?? [];

  const restore = async (name: string) => {
    if (!confirm('恢复此备份？当前配置将先自动备份。')) return;
    const r = await api.restore(name);
    if (r.ok) { toast('已恢复'); refresh(); } else toast(r.error || '恢复失败', 'err');
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          历史备份 ({backups.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 max-w-md">
        {!backups.length ? (
          <p className="text-sm text-muted-foreground">自动备份将在应用配置时生成</p>
        ) : (
          <div className="divide-y">
            {backups.slice(0, 6).map(b => (
              <div key={b.name} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">{timeAgo(b.mtime)} · {(b.size / 1024).toFixed(1)}KB</span>
                <Button size="sm" variant="ghost" onClick={() => restore(b.name)}>恢复</Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
