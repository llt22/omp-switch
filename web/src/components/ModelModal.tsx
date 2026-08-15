import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ChevronRight } from 'lucide-react';
import type { ModelCfg } from '@/lib/api';

interface Props {
  model: ModelCfg | undefined;
  providerType?: string;
  onClose: () => void;
  onSave: (m: ModelCfg) => void;
}

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function ModelModal({ model, providerType, onClose, onSave }: Props) {
  const isAnthropic = providerType === 'anthropic';
  const [id, setId] = useState(model?.id ?? '');
  const [name, setName] = useState(model?.name ?? '');
  const [ctx, setCtx] = useState(String(model?.contextWindow ?? (isAnthropic ? 1000000 : 250000)));
  const [max, setMax] = useState(String(model?.maxTokens ?? 128000));
  const [inputType, setInputType] = useState((model?.input ?? ['text']).join(','));
  const [reasoning, setReasoning] = useState(!!model?.reasoning);
  const [mode, setMode] = useState(model?.thinking?.mode ?? '');
  const [minL, setMinL] = useState(model?.thinking?.minLevel ?? '');
  const [maxL, setMaxL] = useState(model?.thinking?.maxLevel ?? '');
  const [effortMap, setEffortMap] = useState<Record<string, string>>(model?.compat?.reasoningEffortMap ?? {});
  const [showAdv, setShowAdv] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEffortMap(model?.compat?.reasoningEffortMap ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!id.trim()) { setError('模型 ID 不能为空'); return; }
    const map = Object.fromEntries(Object.entries(effortMap).filter(([, v]) => v.trim()));
    onSave({
      id: id.trim(),
      name: name.trim() || undefined,
      contextWindow: Number(ctx) || undefined,
      maxTokens: Number(max) || undefined,
      input: inputType.split(',').filter(Boolean),
      reasoning: reasoning || undefined,
      thinking: { mode: mode || undefined, minLevel: minL || undefined, maxLevel: maxL || undefined },
      compat: {
        supportsReasoningEffort: reasoning || undefined,
        thinkingFormat: 'openai',
        reasoningContentField: 'reasoning_content',
        maxTokensField: undefined,
        reasoningEffortMap: Object.keys(map).length ? map : undefined,
      },
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>编辑模型</DialogTitle></DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>模型 ID <span className="text-destructive">*</span></Label>
            <Input value={id} onChange={e => setId(e.target.value)} spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label>显示名称</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>上下文窗口</Label>
            <Input type="number" value={ctx} onChange={e => setCtx(e.target.value)} placeholder="250000" />
          </div>
          <div className="space-y-1.5">
            <Label>最大输出</Label>
            <Input type="number" value={max} onChange={e => setMax(e.target.value)} placeholder="128000" />
          </div>
          <div className="space-y-1.5">
            <Label>输入类型</Label>
            <Select value={inputType} onValueChange={setInputType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">文本</SelectItem>
                <SelectItem value="text,image">文本 + 图片</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={reasoning} onCheckedChange={setReasoning} />
          <Label>启用思考 (reasoning)</Label>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label className="text-sm font-medium">思考设置</Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>模式</Label>
              <Select value={mode} onValueChange={v => setMode(v === 'default' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认</SelectItem>
                  <SelectItem value="effort">effort</SelectItem>
                  <SelectItem value="off">off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>最低级别</Label>
              <Select value={minL} onValueChange={setMinL}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>最高级别</Label>
              <Select value={maxL} onValueChange={setMaxL}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>级别映射 <span className="font-normal text-muted-foreground">（供应商叫法不同时才填，如 GLM 的 minimal → none）</span></Label>
          <div className="grid grid-cols-3 gap-2">
            {['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(lv => (
              <div key={lv} className="flex items-center gap-1.5">
                <span className="w-14 text-xs text-muted-foreground">{lv}</span>
                <Input className="h-8 text-xs" value={effortMap[lv] ?? ''}
                  onChange={e => setEffortMap({ ...effortMap, [lv]: e.target.value })} placeholder="—" />
              </div>
            ))}
          </div>
        </div>

        <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setShowAdv(!showAdv)}>
          <ChevronRight className={`size-4 transition-transform ${showAdv ? 'rotate-90' : ''}`} /> 高级兼容 (compat)
        </Button>
        {showAdv && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>思考格式</Label>
              <Select value="openai">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">openai</SelectItem>
                  <SelectItem value="openrouter">openrouter</SelectItem>
                  <SelectItem value="zai">zai</SelectItem>
                  <SelectItem value="qwen">qwen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>推理字段</Label>
              <Select value="reasoning_content">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reasoning_content">reasoning_content</SelectItem>
                  <SelectItem value="reasoning">reasoning</SelectItem>
                  <SelectItem value="reasoning_text">reasoning_text</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Token 字段</Label>
              <Select value="auto">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="max_tokens">max_tokens</SelectItem>
                  <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
