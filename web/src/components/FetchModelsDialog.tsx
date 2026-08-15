import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  apiKey?: string;
  apiType: string;
  headers?: Record<string, string>;
  existing: Set<string>;
  onAdd: (ids: string[]) => void;
  providerId?: string;
}

export function FetchModelsDialog({ open, onClose, baseUrl, apiKey, apiType, headers, existing, onAdd, providerId }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.fetchModels(baseUrl, apiKey, apiType, headers, providerId).then(r => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok && r.models) {
        setModels(r.models);
        setPicked(new Set(r.models.filter(m => existing.has(m))));
      } else {
        setError(r.error || '拉取失败');
      }
    });
    return () => { cancelled = true; };
  }, [open, baseUrl, apiKey, apiType]);

  const all = picked.size === models.length && models.length > 0;
  const toggleAll = (on: boolean) => setPicked(on ? new Set(models) : new Set());
  const toggleOne = (m: string, on: boolean) => {
    const next = new Set(picked);
    on ? next.add(m) : next.delete(m);
    setPicked(next);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader><DialogTitle>选择模型</DialogTitle></DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">正在请求模型列表…</p>}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
          {!loading && !error && (
            <>
              <label className="mb-1 flex items-center gap-2 border-b pb-2 text-sm">
                <Checkbox checked={all} onCheckedChange={toggleAll} />
                全选 ({models.length})
              </label>
              <div className="space-y-0.5">
                {models.map(m => (
                  <label key={m} className="flex items-center gap-2 py-1 text-sm">
                    <Checkbox checked={picked.has(m)} onCheckedChange={on => toggleOne(m, !!on)} />
                    <span className="font-mono text-[12px]">{m}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <span className="mr-auto text-xs text-primary">已选 {picked.size}</span>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!picked.size} onClick={() => onAdd([...picked])}>添加选中</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
