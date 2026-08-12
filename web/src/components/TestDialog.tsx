import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type ProviderCfg } from '@/lib/api';

interface Props {
  provider: ProviderCfg;
  open: boolean;
  onClose: () => void;
}

export function TestDialog({ provider, open, onClose }: Props) {
  const [modelId, setModelId] = useState(provider.models[0]?.id ?? '');
  const [effort, setEffort] = useState('medium');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (open) { setModelId(provider.models[0]?.id ?? ''); setResult(null); }
  }, [open, provider]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const r = await api.test(provider.id, modelId, effort);
    setRunning(false);
    if (r.ok) {
      setResult({ ok: true, text: `✓ 连接正常  TTFT: ${r.ttftMs ?? '—'}ms  总耗时: ${r.totalMs}ms\n回复: ${r.text || ''}` });
    } else {
      setResult({ ok: false, text: `✗ ${r.status ? 'HTTP ' + r.status + ' ' : ''}${r.error || '失败'}  (${r.totalMs}ms)` });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>连通性测试 · {provider.name}</DialogTitle></DialogHeader>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <span className="text-xs text-muted-foreground">模型</span>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {provider.models.map(m => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32 space-y-1.5">
            <span className="text-xs text-muted-foreground">思考级别</span>
            <Select value={effort} onValueChange={setEffort}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low', 'medium', 'high', 'xhigh'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={running}>{running ? '测试中…' : '测试'}</Button>
        </div>
        {result && (
          <pre className={`mt-3 whitespace-pre-wrap rounded-md border p-3 font-mono text-xs ${result.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-destructive/40 bg-destructive/5 text-destructive'}`}>
            {result.text}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
