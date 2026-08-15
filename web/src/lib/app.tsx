import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, type State } from '@/lib/api';

interface AppCtx {
  state: State | null;
  loading: boolean;
  loadError: string;
  refresh: () => Promise<boolean>;
  toast: (msg: string, type?: 'ok' | 'err') => void;
}

const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toastMsg, setToastMsg] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const refresh = useCallback(async (retries = 3): Promise<boolean> => {
    try {
      const s = await api.state();
      if (s && !('error' in s)) {
        setState(s);
        setLoadError('');
        setLoading(false);
        return true;
      } else if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return refresh(retries - 1);
      } else {
        setState(null);
        setLoadError('error' in s && typeof s.error === 'string' ? s.error : '无法加载应用状态');
        setLoading(false);
        return false;
      }
    } catch {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 800));
        return refresh(retries - 1);
      } else {
        setState(null);
        setLoadError('无法连接本地服务，请重启应用后重试');
        setLoading(false);
        return false;
      }
    }
  }, []);

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg({ msg, type });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  return (
    <Ctx.Provider value={{ state, loading, loadError, refresh, toast }}>
      {children}
      {toastMsg && (
        <div role={toastMsg.type === 'err' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-full px-5 py-2.5 text-sm text-white shadow-lg ${toastMsg.type === 'err' ? 'bg-destructive' : 'bg-foreground'}`}>
          {toastMsg.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
