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

const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const CONTEXT_WINDOW_OPTIONS = [
  { value: '200000', label: '200K' },
  { value: '250000', label: '250K' },
  { value: '262144', label: '256 Ki' },
  { value: '400000', label: '400K' },
  { value: '1000000', label: '1M' },
  { value: '2000000', label: '2M' },
];

const EFFORT_MAPPING_OPTIONS = ['none', 'off', 'disabled', ...LEVELS];

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
  const [thinkingFormat, setThinkingFormat] = useState(model?.compat?.thinkingFormat ?? 'openai');
  const [reasoningContentField, setReasoningContentField] = useState(model?.compat?.reasoningContentField ?? 'reasoning_content');
  const [maxTokensField, setMaxTokensField] = useState(model?.compat?.maxTokensField ?? (isAnthropic ? 'max_tokens' : 'max_completion_tokens'));
  const [showAdv, setShowAdv] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEffortMap(model?.compat?.reasoningEffortMap ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!id.trim()) { setError('模型 ID 不能为空'); return; }
    if (!Number.isInteger(Number(ctx)) || Number(ctx) <= 0) { setError('上下文窗口必须是正整数'); return; }
    if (!Number.isInteger(Number(max)) || Number(max) <= 0) { setError('最大输出必须是正整数'); return; }
    const map = Object.fromEntries(Object.entries(effortMap).filter(([, v]) => v.trim()));
    onSave({
      ...model,
      id: id.trim(),
      name: name.trim() || undefined,
      contextWindow: Number(ctx),
      maxTokens: Number(max),
      input: inputType.split(',').filter(Boolean),
      reasoning: reasoning || undefined,
      thinking: { ...model?.thinking, mode: mode || undefined, minLevel: minL || undefined, maxLevel: maxL || undefined },
      compat: {
        ...model?.compat,
        supportsReasoningEffort: reasoning || undefined,
        thinkingFormat,
        reasoningContentField,
        maxTokensField,
        reasoningEffortMap: Object.keys(map).length ? map : undefined,
      },
      limitsEstimated: false,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>编辑模型</DialogTitle></DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">

        {model?.limitsEstimated && (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            上下文窗口和最大输出是通用估值，请按供应商文档确认后保存。
          </div>
        )}

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

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>上下文窗口</Label>
            <div className="flex gap-1.5">
              <Input className="min-w-0" type="number" value={ctx} onChange={e => setCtx(e.target.value)} placeholder="250000" />
              <Select value={CONTEXT_WINDOW_OPTIONS.some(option => option.value === ctx) ? ctx : ''} onValueChange={setCtx}>
                <SelectTrigger className="w-[4.75rem] shrink-0" aria-label="快捷选择上下文窗口">
                  <SelectValue placeholder="快捷" />
                </SelectTrigger>
                <SelectContent>
                  {CONTEXT_WINDOW_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                <Input className="h-8 text-xs" list="effort-mapping-options" aria-label={`${lv} 级别映射`} value={effortMap[lv] ?? ''}
                  onChange={e => setEffortMap({ ...effortMap, [lv]: e.target.value })} placeholder="—" />
              </div>
            ))}
          </div>
          <datalist id="effort-mapping-options">
            {EFFORT_MAPPING_OPTIONS.map(value => <option key={value} value={value} />)}
          </datalist>
        </div>

        <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setShowAdv(!showAdv)}>
          <ChevronRight className={`size-4 transition-transform ${showAdv ? 'rotate-90' : ''}`} /> 高级兼容 (compat)
        </Button>
        {showAdv && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>思考格式</Label>
              <Select value={thinkingFormat} onValueChange={setThinkingFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">openai</SelectItem>
                  <SelectItem value="openrouter">openrouter</SelectItem>
                  <SelectItem value="zai">zai</SelectItem>
                  <SelectItem value="qwen">qwen</SelectItem>
                  <SelectItem value="qwen-chat-template">qwen-chat-template</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>推理字段</Label>
              <Select value={reasoningContentField} onValueChange={setReasoningContentField}>
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
              <Select value={maxTokensField} onValueChange={v => setMaxTokensField(v as 'max_tokens' | 'max_completion_tokens')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="max_tokens">max_tokens</SelectItem>
                  <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        </div>

        <DialogFooter className="border-t pt-4">
          {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
