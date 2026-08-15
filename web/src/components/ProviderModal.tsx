import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ChevronRight, Plus, RefreshCw, X } from 'lucide-react';
import { TYPES, api, defaultModel, type ModelCfg, type ProviderCfg } from '@/lib/api';
import { useApp } from '@/lib/app';
import { ModelModal } from './ModelModal';
import { FetchModelsDialog } from './FetchModelsDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  editing: ProviderCfg | null;
  duplicate?: ProviderCfg | null;
}

export function ProviderModal({ open, onClose, editing, duplicate }: Props) {
  const { state, refresh, toast } = useApp();
  const [type, setType] = useState<'openai-compatible' | 'anthropic' | 'openai' | 'gemini'>('openai-compatible');
  const [name, setName] = useState('');
  const [pid, setPid] = useState('');
  const [pidTouched, setPidTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiType, setApiType] = useState('openai-completions');
  const [authHeader, setAuthHeader] = useState(true);
  const [headersText, setHeadersText] = useState('');
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [error, setError] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const [showFetch, setShowFetch] = useState(false);
  const [modelModalIdx, setModelModalIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const def = TYPES.find(t => t.type === editing.type)!;
      setType(editing.type);
      setName(editing.name);
      setPid(editing.id);
      setPidTouched(true);
      setBaseUrl(editing.baseUrl);
      setApiKey('');
      setApiType(editing.api);
      setAuthHeader(editing.authHeader ?? def.auth);
      setHeadersText(editing.headers && Object.keys(editing.headers).length ? JSON.stringify(editing.headers, null, 2) : '');
      setModels(JSON.parse(JSON.stringify(editing.models)));
    } else if (duplicate) {
      const def = TYPES.find(t => t.type === duplicate.type)!;
      setType(duplicate.type);
      setName(`${duplicate.name} 副本`);
      setPid(`${duplicate.id}-copy`);
      setPidTouched(true);
      setBaseUrl(duplicate.baseUrl);
      setApiKey('');
      setApiType(duplicate.api);
      setAuthHeader(duplicate.authHeader ?? def.auth);
      setHeadersText(duplicate.headers && Object.keys(duplicate.headers).length ? JSON.stringify(duplicate.headers, null, 2) : '');
      setModels(JSON.parse(JSON.stringify(duplicate.models)));
    } else {
      const def = TYPES.find(t => t.type === 'openai-compatible')!;
      setType('openai-compatible');
      setName('');
      setPid('');
      setPidTouched(false);
      setBaseUrl(def.baseUrl);
      setApiKey('');
      setApiType(def.api);
      setAuthHeader(def.auth);
      setHeadersText('');
      setModels([]);
    }
    setError('');
    setShowAdv(false);
  }, [open, editing, duplicate]);

  const pickType = (t: (typeof TYPES)[number]['type']) => {
    setType(t);
    const def = TYPES.find(x => x.type === t)!;
    setApiType(def.api);
    if (!editing) { setBaseUrl(def.baseUrl); setAuthHeader(def.auth); }
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!editing && !pidTouched) {
      setPid(v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
    }
  };

  const save = async () => {
    setError('');
    let headers: Record<string, string> = {};
    try {
      const v = headersText.trim();
      if (v) {
        const parsed = JSON.parse(v);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) {
          setError('Headers 必须是字符串键值对 JSON 对象');
          return;
        }
        headers = parsed;
      }
    } catch { setError('Headers 不是合法 JSON'); return; }
    const id = (editing ? editing.id : pid).trim();
    if (!name.trim()) { setError('供应商名称不能为空'); return; }
    if (!id) { setError('Provider ID 不能为空（中文名需手动填写 ID）'); setShowAdv(true); return; }
    if (!editing && state?.providers.some(provider => provider.id === id)) { setError(`Provider ID “${id}” 已存在`); setShowAdv(true); return; }
    if (!baseUrl.trim()) { setError('Base URL 不能为空'); return; }
    if (!models.length) { setError('至少需要一个模型'); return; }
    setSaving(true);
    try {
      const r = await api.saveProvider({
        id, name: name.trim(), type, api: apiType, baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined, authHeader, headers, models, enabled: editing?.enabled ?? true,
      });
      if (r.ok) { toast(editing ? '已保存到编辑区' : '已添加到编辑区'); onClose(); await refresh(); }
      else setError(r.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>{editing ? '编辑供应商' : duplicate ? '复制供应商' : '添加供应商'}</DialogTitle></DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">

          {!editing && (
            <div className="grid grid-cols-4 gap-2">
              {TYPES.map(t => (
                <button key={t.type} onClick={() => pickType(t.type)}
                  className={`rounded-lg border p-3 text-center transition-colors ${type === t.type ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}>
                  <div className="text-xl">{t.icon}</div>
                  <div className="text-[13px] font-medium">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>供应商名称 <span className="text-destructive">*</span></Label>
              <Input value={name} onChange={e => onNameChange(e.target.value)} placeholder="例如：我的 OpenAI 网关" />
            </div>
            <div className="space-y-1.5">
              <Label>Base URL <span className="text-destructive">*</span></Label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>API Key {editing?.apiKeyMasked && <span className="text-muted-foreground">（当前 {editing.apiKeyMasked}，留空不更改）</span>}</Label>
            <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={duplicate ? '复制自原供应商，请填写新 Key' : 'sk-...'} autoComplete="off" />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">模型</Label>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                try {
                  const parsed = headersText.trim() ? JSON.parse(headersText) : {};
                  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error();
                  setError('');
                  setShowFetch(true);
                } catch { setError('请先修正自定义 Headers JSON'); setShowAdv(true); }
              }}>
                <RefreshCw className="size-3.5" /> 拉取模型列表
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setModelModalIdx(models.length)}>
                <Plus className="size-3.5" /> 手动添加
              </Button>
            </div>
          </div>

          {models.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型 ID</TableHead>
                  <TableHead className="w-20">上下文</TableHead>
                  <TableHead className="w-20">MaxTokens</TableHead>
                  <TableHead className="w-16">思考</TableHead>
                  <TableHead className="w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-[12px]">{m.id}</TableCell>
                    <TableCell className="text-muted-foreground" title={m.limitsEstimated ? '通用估值，需确认' : undefined}>{m.contextWindow ? `${m.limitsEstimated ? '~' : ''}${Math.round(m.contextWindow / 1000)}K` : '—'}</TableCell>
                    <TableCell className="text-muted-foreground" title={m.limitsEstimated ? '通用估值，需确认' : undefined}>{m.maxTokens ? `${m.limitsEstimated ? '~' : ''}${Math.round(m.maxTokens / 1000)}K` : '—'}</TableCell>
                    <TableCell>{m.reasoning ? '✓' : '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setModelModalIdx(i)}>编辑</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setModels(models.filter((_, j) => j !== i))}>
                        <X className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">拉取模型列表或手动添加</p>
          )}

          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setShowAdv(!showAdv)}>
            <ChevronRight className={`size-4 transition-transform ${showAdv ? 'rotate-90' : ''}`} /> 高级设置
          </Button>
          {showAdv && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Provider ID</Label>
                  <Input value={pid} onChange={e => { setPidTouched(true); setPid(e.target.value); }} disabled={!!editing} placeholder="按名称自动生成" spellCheck={false} />
                </div>
                <div className="space-y-1.5">
                  <Label>API 协议</Label>
                  <Select value={apiType} onValueChange={setApiType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(state?.apiOptions ?? {}).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={authHeader} onCheckedChange={setAuthHeader} />
                <Label>注入 Authorization: Bearer 头</Label>
              </div>
              <div className="space-y-1.5">
                <Label>自定义 Headers（JSON）</Label>
                <Textarea value={headersText} onChange={e => setHeadersText(e.target.value)} rows={2} placeholder='{"X-Custom":"value"}' className="font-mono text-xs" />
              </div>
            </div>
          )}
          </div>

          <DialogFooter className="border-t pt-4">
            {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {modelModalIdx !== null && (
        <ModelModal
          model={models[modelModalIdx]}
          providerType={type}
          onClose={() => setModelModalIdx(null)}
          onSave={(m) => {
            const next = [...models];
            next[modelModalIdx] = m;
            setModels(next);
            setModelModalIdx(null);
          }}
        />
      )}

      <FetchModelsDialog
        open={showFetch}
        onClose={() => setShowFetch(false)}
        baseUrl={baseUrl}
        apiKey={apiKey}
        apiType={apiType}
        headers={(() => { try { return headersText.trim() ? JSON.parse(headersText) : undefined; } catch { return undefined; } })()}
        existing={new Set(models.map(m => m.id))}
        providerId={editing?.id}
        onAdd={(ids) => {
          const have = new Set(models.map(m => m.id));
          setModels([...models, ...ids.filter(id => !have.has(id)).map(id => defaultModel(id, type))]);
          setShowFetch(false);
        }}
      />
    </>
  );
}
