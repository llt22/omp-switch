import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ChevronRight } from 'lucide-react';
import { api, type ModelCfg } from '@/lib/api';

interface Props {
  model: ModelCfg | undefined;
  providerId: string;
  apiType: string;
  baseUrl: string;
  onClose: () => void;
  onSave: (model: ModelCfg) => void;
}

const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const THINKING_MODES = ['effort', 'budget', 'google-level', 'anthropic-adaptive', 'anthropic-budget-effort'];
const CONTEXT_WINDOW_OPTIONS = [
  { value: '200000', label: '200K' },
  { value: '250000', label: '250K' },
  { value: '262144', label: '256 Ki' },
  { value: '400000', label: '400K' },
  { value: '1000000', label: '1M' },
  { value: '2000000', label: '2M' },
];
const EFFORT_MAPPING_OPTIONS = ['none', 'off', 'disabled', ...LEVELS];

function configuredEfforts(model: ModelCfg | undefined): string[] {
  if (model?.thinking?.efforts?.length) return [...model.thinking.efforts];
  const min = LEVELS.indexOf(model?.thinking?.minLevel ?? '');
  const max = LEVELS.indexOf(model?.thinking?.maxLevel ?? '');
  return min >= 0 && max >= min ? LEVELS.slice(min, max + 1) : [];
}

type LookupState = 'idle' | 'waiting' | 'loading' | 'matched' | 'unmatched' | 'error';

export function ModelModal({ model, providerId, apiType, baseUrl, onClose, onSave }: Props) {
  const originalId = model?.id.trim() ?? '';
  const [id, setId] = useState(model?.id ?? '');
  const [name, setName] = useState(model?.name ?? '');
  const [ctx, setCtx] = useState(model?.contextWindow === undefined ? '' : String(model.contextWindow));
  const [max, setMax] = useState(model?.maxTokens === undefined ? '' : String(model.maxTokens));
  const [inputType, setInputType] = useState(model?.input?.join(',') ?? '');
  const [reasoning, setReasoning] = useState(!!model?.reasoning);
  const [mode, setMode] = useState(model?.thinking?.mode ?? '');
  const [efforts, setEfforts] = useState<string[]>(configuredEfforts(model));
  const [effortMap, setEffortMap] = useState<Record<string, string>>(
    model?.thinking?.effortMap ?? model?.compat?.reasoningEffortMap ?? {},
  );
  const [thinkingFormat, setThinkingFormat] = useState(model?.compat?.thinkingFormat ?? '');
  const [reasoningContentField, setReasoningContentField] = useState(model?.compat?.reasoningContentField ?? '');
  const [maxTokensField, setMaxTokensField] = useState(model?.compat?.maxTokensField ?? '');
  const [catalogModel, setCatalogModel] = useState<ModelCfg | undefined>(model?.catalog ? model : undefined);
  const [catalog, setCatalog] = useState(model?.catalog);
  const [lookupState, setLookupState] = useState<LookupState>(model?.catalog ? 'matched' : 'idle');
  const [showAdv, setShowAdv] = useState(false);
  const [error, setError] = useState('');
  const configTouched = useRef(false);
  const requestSequence = useRef(0);

  const touch = () => { configTouched.current = true; };

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const modelId = id.trim();
    if (!modelId || modelId === originalId) {
      setLookupState(model?.catalog ? 'matched' : 'idle');
      setCatalog(model?.catalog);
      setCatalogModel(model?.catalog ? model : undefined);
      return;
    }
    setLookupState('waiting');
    setCatalog(undefined);
    setCatalogModel(undefined);
    const timer = window.setTimeout(async () => {
      setLookupState('loading');
      const result = await api.resolveModels([modelId], providerId.trim() || 'custom', apiType, baseUrl);
      if (sequence !== requestSequence.current) return;
      if (!result.ok) {
        setLookupState('error');
        setError(result.error || 'OMP 模型数据获取失败');
        return;
      }
      const match = result.matches?.[0];
      if (!match?.matched || !match.model || !match.reference) {
        setLookupState('unmatched');
        setError('');
        return;
      }
      const resolved = match.model;
      const source = {
        source: result.source ?? 'OMP 在线模型目录',
        referenceProvider: match.reference.provider,
        referenceId: match.reference.id,
      };
      setCatalog(source);
      setCatalogModel(resolved);
      setLookupState('matched');
      setError('');
      if (configTouched.current) return;
      setName(resolved.name ?? '');
      setCtx(resolved.contextWindow === undefined ? '' : String(resolved.contextWindow));
      setMax(resolved.maxTokens === undefined ? '' : String(resolved.maxTokens));
      setInputType(resolved.input?.join(',') ?? '');
      setReasoning(!!resolved.reasoning);
      setMode(resolved.thinking?.mode ?? '');
      setEfforts(resolved.thinking?.efforts ?? []);
      setEffortMap(resolved.thinking?.effortMap ?? resolved.compat?.reasoningEffortMap ?? {});
      setThinkingFormat(resolved.compat?.thinkingFormat ?? '');
      setReasoningContentField(resolved.compat?.reasoningContentField ?? '');
      setMaxTokensField(resolved.compat?.maxTokensField ?? '');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [id, originalId, providerId, apiType, baseUrl]);

  const toggleEffort = (level: string, enabled: boolean) => {
    touch();
    setEfforts(current => enabled
      ? LEVELS.filter(item => current.includes(item) || item === level)
      : current.filter(item => item !== level));
  };

  const save = () => {
    if (!id.trim()) { setError('模型 ID 不能为空'); return; }
    if (ctx && (!Number.isInteger(Number(ctx)) || Number(ctx) <= 0)) { setError('上下文窗口必须是正整数'); return; }
    if (max && (!Number.isInteger(Number(max)) || Number(max) <= 0)) { setError('最大输出必须是正整数'); return; }
    const map = Object.fromEntries(Object.entries(effortMap).filter(([, value]) => value.trim()));
    const sourceModel = catalogModel ?? model;
    const thinking = reasoning && mode && efforts.length
      ? {
          ...sourceModel?.thinking,
          mode,
          efforts,
          minLevel: undefined,
          maxLevel: undefined,
          effortMap: Object.keys(map).length ? map : undefined,
        }
      : undefined;
    const compat: ModelCfg['compat'] = {
      ...sourceModel?.compat,
      thinkingFormat: thinkingFormat || undefined,
      reasoningContentField: reasoningContentField || undefined,
      maxTokensField: maxTokensField
        ? maxTokensField as 'max_tokens' | 'max_completion_tokens'
        : undefined,
      reasoningEffortMap: undefined,
    };
    onSave({
      ...sourceModel,
      id: id.trim(),
      name: name.trim() || undefined,
      contextWindow: ctx ? Number(ctx) : undefined,
      maxTokens: max ? Number(max) : undefined,
      input: inputType ? inputType.split(',').filter(Boolean) : undefined,
      reasoning: reasoning || undefined,
      thinking,
      compat: Object.values(compat).some(value => value !== undefined) ? compat : undefined,
      catalog,
      limitsEstimated: undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>编辑模型</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {lookupState === 'matched' && catalog && (
            <div role="status" className="rounded-md border bg-muted/50 p-2.5 text-xs text-muted-foreground">
              OMP 已匹配 <span className="font-mono text-foreground">{catalog.referenceProvider}/{catalog.referenceId}</span>
            </div>
          )}
          {lookupState === 'unmatched' && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              OMP 未收录该模型，将保留当前手动配置。
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>模型 ID <span className="text-destructive">*</span></Label>
              <Input value={id} onChange={event => setId(event.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label>显示名称</Label>
              <Input value={name} onChange={event => { touch(); setName(event.target.value); }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>上下文窗口</Label>
              <div className="flex gap-1.5">
                <Input className="min-w-0" type="number" value={ctx} onChange={event => { touch(); setCtx(event.target.value); }} placeholder="未设置" />
                <Select value={CONTEXT_WINDOW_OPTIONS.some(option => option.value === ctx) ? ctx : 'custom'} onValueChange={value => { if (value !== 'custom') { touch(); setCtx(value); } }}>
                  <SelectTrigger className="w-[4.75rem] shrink-0" aria-label="快捷选择上下文窗口"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">自定义</SelectItem>
                    {CONTEXT_WINDOW_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>最大输出</Label>
              <Input type="number" value={max} onChange={event => { touch(); setMax(event.target.value); }} placeholder="未设置" />
            </div>
            <div className="space-y-1.5">
              <Label>输入类型</Label>
              <Select value={inputType || 'unset'} onValueChange={value => { touch(); setInputType(value === 'unset' ? '' : value); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">未设置</SelectItem>
                  <SelectItem value="text">文本</SelectItem>
                  <SelectItem value="text,image">文本 + 图片</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={reasoning} onCheckedChange={value => { touch(); setReasoning(value); }} />
            <Label>启用思考 (reasoning)</Label>
          </div>

          <Separator />
          <div className="space-y-3">
            <Label className="text-sm font-medium">思考设置</Label>
            <div className="space-y-1.5">
              <Label>模式</Label>
              <Select value={mode || 'unset'} onValueChange={value => { touch(); setMode(value === 'unset' ? '' : value); }} disabled={!reasoning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">不可调节</SelectItem>
                  {THINKING_MODES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map(level => (
                <label key={level} className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs">
                  <Checkbox checked={efforts.includes(level)} disabled={!reasoning || !mode} onCheckedChange={checked => toggleEffort(level, !!checked)} />
                  {level}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>级别映射</Label>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map(level => (
                <div key={level} className="flex items-center gap-1.5">
                  <span className="w-14 text-xs text-muted-foreground">{level}</span>
                  <Input className="h-8 text-xs" list="effort-mapping-options" aria-label={`${level} 级别映射`} value={effortMap[level] ?? ''}
                    onChange={event => { touch(); setEffortMap({ ...effortMap, [level]: event.target.value }); }} placeholder="—" />
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
                <Select value={thinkingFormat || 'unset'} onValueChange={value => { touch(); setThinkingFormat(value === 'unset' ? '' : value); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">未设置</SelectItem>
                    {['openai', 'openrouter', 'kimi', 'zai', 'qwen', 'qwen-chat-template', 'chat-template'].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>推理字段</Label>
                <Select value={reasoningContentField || 'unset'} onValueChange={value => { touch(); setReasoningContentField(value === 'unset' ? '' : value); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">未设置</SelectItem>
                    {['reasoning_content', 'reasoning', 'reasoning_text'].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Token 字段</Label>
                <Select value={maxTokensField || 'unset'} onValueChange={value => { touch(); setMaxTokensField(value === 'unset' ? '' : value); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">未设置</SelectItem>
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
          <Button onClick={save} disabled={lookupState === 'waiting' || lookupState === 'loading'}>
            {lookupState === 'waiting' || lookupState === 'loading' ? '正在匹配 OMP…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
